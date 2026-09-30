# Owner task: EB-25 Cross-tenant isolation suite
"""Cross-tenant leakage checks against every tenant-scoped surface.

Two tenants share the *same* pooled resources (one OpenSearch alias, one Qdrant shard, one object bucket) —
the hard case for isolation. Each tenant holds a unique canary string; a check fails the moment one tenant can
read, list, search, write to or authorize anything that belongs to the other.

Used by pytest (tests/) and by CI: ``python services/evaluation/leakage/cross_tenant.py`` exits non-zero on any
leak and prints one line per check (release-gate input for EB-69).
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from typing import Callable

from storage import (
    FgaStore, LocalFgaBackend, LocalObjectBackend, LocalSearchBackend, LocalVectorBackend,
    ObjectStore, SearchStore, TupleKey, VectorPoint, VectorStore,
)
from tenant_context import (
    CrossTenantAccessError, NoTenantContextError, Placement, TenantContext, TenantStatus, Tier, tenant_scope,
)

TENANT_A = "tenant-a"
TENANT_B = "tenant-b"
CANARY = {TENANT_A: "CANARY-ALPHA-7781", TENANT_B: "CANARY-BRAVO-4420"}


@dataclass(frozen=True)
class LeakageResult:
    name: str
    passed: bool
    detail: str = ""


def make_ctx(tenant_id: str) -> TenantContext:
    """Pool-tier context: shared alias, shared shard, shared bucket, per-tenant object prefix and FGA store."""
    p = Placement(
        cell_id="c1", region="ap-south-2", pg_cluster="pg", pg_database="brain",
        object_bucket="shared-bucket", object_prefix=f"tenants/{tenant_id}/", qdrant_cluster="q",
        qdrant_shard_key="pool", opensearch_cluster="os", opensearch_index="shared",
        opensearch_alias="shared-alias", fga_store=f"fga-{tenant_id}", temporal_namespace="c1",
        temporal_queue_prefix="pool", litellm_team=f"tenant-{tenant_id}", kms_key_ref=f"alias/{tenant_id}",
    )
    return TenantContext(tenant_id, tenant_id, TenantStatus.ACTIVE, Tier.POOL, p)


class World:
    """Both tenants seeded into the same backends."""

    def __init__(self, tmp_root) -> None:
        self.search = SearchStore(LocalSearchBackend())
        self.vector = VectorStore(LocalVectorBackend())
        self.objects = ObjectStore(LocalObjectBackend(tmp_root))
        self.fga = FgaStore(LocalFgaBackend(), cache_ttl_seconds=0)
        for tid in (TENANT_A, TENANT_B):
            with tenant_scope(make_ctx(tid)):
                text = f"budget note {CANARY[tid]}"
                self.search.index(f"doc-{tid}", {"text": text, "document_id": f"doc-{tid}", "project_id": f"proj-{tid}"})
                self.vector.upsert([VectorPoint(id=f"pt-{tid}", vector=[1.0, 0.0],
                                                payload={"text": text, "document_id": f"doc-{tid}", "project_id": f"proj-{tid}"})])
                self.objects.put("contracts/secret.txt", text.encode())
                self.fga.write_tuples([TupleKey(f"user:{tid}-lead", "member", f"project:proj-{tid}"),
                                       TupleKey(f"tenant:{tid}", "parent", f"project:proj-{tid}")], [])


def _other(tid: str) -> str:
    return TENANT_B if tid == TENANT_A else TENANT_A


def run_suite(tmp_root) -> list[LeakageResult]:
    w = World(tmp_root)
    results: list[LeakageResult] = []

    def check(name: str, fn: Callable[[], str | None]) -> None:
        """fn returns None on success or a failure detail string; an unexpected exception is a failure."""
        try:
            detail = fn()
        except Exception as exc:  # noqa: BLE001 - any surprise is reported, never swallowed
            detail = f"unexpected {type(exc).__name__}: {exc}"
        results.append(LeakageResult(name, detail is None, detail or ""))

    for tid in (TENANT_A, TENANT_B):
        other = _other(tid)
        bad = CANARY[other]

        def lexical(tid=tid, bad=bad):
            with tenant_scope(make_ctx(tid)):
                hits = w.search.search({"match": {"text": "budget"}})
                leaked = [h for h in hits if bad in str(h)]
                own = [h for h in hits if CANARY[tid] in str(h)]
            return f"leaked {len(leaked)} foreign hits" if leaked else (None if own else "own data not found (vacuous)")

        def vector(tid=tid, bad=bad):
            with tenant_scope(make_ctx(tid)):
                pts = w.vector.search([1.0, 0.0])
                leaked = [p for p in pts if bad in str(p.payload)]
                own = [p for p in pts if CANARY[tid] in str(p.payload)]
            return f"leaked {len(leaked)} foreign points" if leaked else (None if own else "own data not found (vacuous)")

        def objects(tid=tid, other=other, bad=bad):
            with tenant_scope(make_ctx(tid)):
                if bad.encode() in w.objects.get("contracts/secret.txt"):
                    return "read foreign object via same key"
                if any(other in k for k in w.objects.list()):
                    return "listing exposes foreign keys"
                for evil in (f"../{other}/contracts/secret.txt", f"/tenants/{other}/contracts/secret.txt"):
                    try:
                        w.objects.get(evil)
                    except ValueError:
                        continue
                    return f"path escape accepted: {evil}"
            return None

        def fga(tid=tid, other=other):
            with tenant_scope(make_ctx(tid)):
                if w.fga.check(f"user:{other}-lead", "viewer", f"project:proj-{other}"):
                    return "foreign user authorized on foreign project"
                if w.fga.list_objects(f"user:{other}-lead", "viewer", "project"):
                    return "foreign user lists projects"
                if not w.fga.check(f"user:{tid}-lead", "viewer", f"project:proj-{tid}"):
                    return "own user lost access (vacuous)"
            return None

        def writes(tid=tid, other=other):
            with tenant_scope(make_ctx(tid)):
                for label, op in (
                    ("search", lambda: w.search.index("x", {"text": "t", "tenant_id": other})),
                    ("vector", lambda: w.vector.upsert([VectorPoint(id="x", vector=[1.0, 0.0], payload={"tenant_id": other})])),
                ):
                    try:
                        op()
                    except CrossTenantAccessError:
                        continue
                    return f"{label} accepted a foreign tenant_id write"
            return None

        check(f"{tid}: lexical search sees only own documents", lexical)
        check(f"{tid}: vector search sees only own points", vector)
        check(f"{tid}: object store is prefix-isolated and path-safe", objects)
        check(f"{tid}: authorization does not cross tenants", fga)
        check(f"{tid}: writes stamped with a foreign tenant_id are refused", writes)

    def no_context():
        ops = (
            lambda: w.search.search({"match_all": {}}), lambda: w.vector.search([1.0, 0.0]),
            lambda: w.objects.get("contracts/secret.txt"), lambda: w.fga.check("user:x", "viewer", "project:p"),
        )
        for i, op in enumerate(ops):
            try:
                op()
            except NoTenantContextError:
                continue
            return f"store #{i} ran without a tenant context"
        return None

    check("every store refuses to run without a tenant context", no_context)
    return results


def main() -> int:
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        results = run_suite(tmp)
    for r in results:
        print(f"{'PASS' if r.passed else 'FAIL'}  {r.name}" + (f"  — {r.detail}" if r.detail else ""))
    failed = [r for r in results if not r.passed]
    print(f"\n{len(results) - len(failed)}/{len(results)} isolation checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
