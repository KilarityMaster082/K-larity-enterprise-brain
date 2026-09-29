"""Owner task: EB-85 Tenant registry and control plane — TenantContext, resolver and store guard tests."""

from __future__ import annotations

import asyncio
import importlib.util
import threading
from dataclasses import replace
from pathlib import Path

import pytest

from tenant_context import (
    CrossTenantAccessError,
    NoTenantContextError,
    Placement,
    PlacementResolver,
    TenantContext,
    TenantScopedStore,
    TenantStatus,
    TenantUnavailableError,
    Tier,
    UnknownTenantError,
    current_tenant,
    current_tenant_or_none,
    tenant_scope,
    validate_tenant_id,
)


def make_ctx(tenant_id: str, status: TenantStatus = TenantStatus.ACTIVE) -> TenantContext:
    p = Placement(cell_id="c1", region="ap-south-2", pg_cluster="pg", pg_database="brain", object_bucket="b",
                  object_prefix=f"tenants/{tenant_id}/", qdrant_cluster="q", qdrant_shard_key="pool",
                  opensearch_cluster="os", opensearch_index="docs", opensearch_alias=f"tenant-{tenant_id}",
                  fga_store="fga", temporal_namespace="c1", temporal_queue_prefix="pool",
                  litellm_team=f"tenant-{tenant_id}", kms_key_ref=f"alias/klarity-tenant-{tenant_id}")
    return TenantContext(tenant_id, tenant_id, status, Tier.POOL, p)


A, B = make_ctx("tenant-a"), make_ctx("tenant-b")


# -- context -----------------------------------------------------------------------------------------------
def test_no_context_fails_closed():
    assert current_tenant_or_none() is None
    with pytest.raises(NoTenantContextError):
        current_tenant()


def test_scope_sets_and_restores_even_on_error():
    with pytest.raises(RuntimeError):
        with tenant_scope(A):
            assert current_tenant() is A
            with tenant_scope(A):  # re-entering the same tenant is fine
                assert current_tenant() is A
            raise RuntimeError
    assert current_tenant_or_none() is None


def test_cannot_switch_tenant_inside_a_scope():
    with tenant_scope(A):
        with pytest.raises(CrossTenantAccessError):
            with tenant_scope(B):
                pass
        assert current_tenant() is A


def test_new_threads_do_not_inherit_the_scope():
    seen: list[BaseException | TenantContext] = []

    def worker() -> None:
        try:
            seen.append(current_tenant())
        except NoTenantContextError as e:
            seen.append(e)

    with tenant_scope(A):
        t = threading.Thread(target=worker)
        t.start()
        t.join()
    assert isinstance(seen[0], NoTenantContextError)


def test_concurrent_tasks_keep_their_own_tenant():
    async def job(ctx: TenantContext) -> str:
        with tenant_scope(ctx):
            await asyncio.sleep(0)
            return current_tenant().tenant_id

    async def main() -> list[str]:
        return list(await asyncio.gather(*(job(A if i % 2 else B) for i in range(20))))

    assert asyncio.run(main()) == ["tenant-b" if i % 2 == 0 else "tenant-a" for i in range(20)]


@pytest.mark.parametrize("bad", ["", "a", "Acme", "acme/../x", "-acme", "acme_1", "a" * 64, "acme.io"])
def test_tenant_id_shape(bad):
    with pytest.raises(ValueError):
        validate_tenant_id(bad)


def test_placement_prefix_must_belong_to_the_tenant():
    with pytest.raises(ValueError):
        replace(A, tenant_id="tenant-b")


def test_placement_round_trips_through_resource_rows():
    rows = A.placement.to_resources()
    assert "keycloak_org_id" not in rows
    assert Placement.from_resources({**rows, "unrelated": "x"}) == A.placement


# -- resolver ----------------------------------------------------------------------------------------------
class Directory:
    def __init__(self, *ctxs: TenantContext) -> None:
        self.tenants = {c.tenant_id: c for c in ctxs}
        self.lookups = 0

    def lookup(self, tenant_id: str) -> TenantContext | None:
        self.lookups += 1
        return self.tenants.get(tenant_id)


class Clock:
    def __init__(self) -> None:
        self.t = 0.0

    def __call__(self) -> float:
        return self.t


def test_resolver_unknown_and_status_rules():
    d = Directory(A, make_ctx("tenant-p", TenantStatus.PROVISIONING))
    r = PlacementResolver(d)
    with pytest.raises(UnknownTenantError):
        r.resolve("tenant-z")
    with pytest.raises(TenantUnavailableError):
        r.resolve("tenant-p")
    assert r.resolve("tenant-p", allow=frozenset({TenantStatus.PROVISIONING})).tenant_id == "tenant-p"
    with pytest.raises(ValueError):
        r.resolve("../etc")


def test_resolver_misses_are_not_cached():
    d = Directory()
    r = PlacementResolver(d)
    with pytest.raises(UnknownTenantError):
        r.resolve("tenant-a")
    d.tenants["tenant-a"] = A
    assert r.resolve("tenant-a") is A


def test_suspension_takes_effect_after_ttl_or_invalidate():
    d, clock = Directory(A), Clock()
    r = PlacementResolver(d, ttl_seconds=30, clock=clock)
    r.resolve("tenant-a")
    d.tenants["tenant-a"] = replace(A, status=TenantStatus.SUSPENDED)
    r.resolve("tenant-a")  # still cached
    assert d.lookups == 1
    clock.t = 31
    with pytest.raises(TenantUnavailableError):
        r.resolve("tenant-a")
    d.tenants["tenant-a"] = A
    r.invalidate("tenant-a")
    assert r.resolve("tenant-a") is A


def test_resolver_scope_enters_the_context():
    r = PlacementResolver(Directory(A))
    with r.scope("tenant-a") as ctx:
        assert current_tenant() is ctx is A
    assert current_tenant_or_none() is None


# -- store guard -------------------------------------------------------------------------------------------
class NotesStore(TenantScopedStore):
    def __init__(self) -> None:
        self.rows: dict[tuple[str, str], str] = {}

    def put(self, key: str, value: str) -> None:
        self.rows[(self._tenant().tenant_id, key)] = value

    def get_for(self, tenant_id: str, key: str) -> str | None:
        return self.rows.get((tenant_id, key))

    def _peek(self) -> int:  # private helpers are not guarded
        return len(self.rows)


class AuditedNotesStore(NotesStore):
    def count(self) -> int:
        return self._peek()


def test_store_call_without_context_fails():
    s = AuditedNotesStore()
    for call in (lambda: s.put("k", "v"), lambda: s.get_for("tenant-a", "k"), s.count):
        with pytest.raises(NoTenantContextError):
            call()
    assert s._peek() == 0


def test_store_call_naming_another_tenant_fails():
    s = NotesStore()
    with tenant_scope(A):
        s.put("k", "secret-a")
        assert s.get_for("tenant-a", "k") == "secret-a"
        with pytest.raises(CrossTenantAccessError):
            s.get_for("tenant-b", "k")
        with pytest.raises(CrossTenantAccessError):
            s.get_for(tenant_id="tenant-b", key="k")


# -- CI lint (ops/ci/check_tenant_scope.py) ----------------------------------------------------------------
def _lint():
    path = Path(__file__).resolve().parents[3] / "ops/ci/check_tenant_scope.py"
    spec = importlib.util.spec_from_file_location("check_tenant_scope", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_lint_blocks_raw_clients_outside_store_wrappers():
    lint = _lint()
    assert lint.check_file("services/context-engine/x.py", "import qdrant_client\n")
    assert lint.check_file("apps/api/x.py", "from psycopg.rows import dict_row\n")
    assert lint.check_file("services/ingestion/x.py", "import boto3.session\n")
    assert not lint.check_file("packages/storage/storage/s3.py", "import boto3\n")
    assert not lint.check_file("services/ingestion/x.py", "from .redis_like import x\nimport json\n")


def test_lint_requires_guard_on_store_classes():
    lint = _lint()
    assert lint.check_file("packages/storage/storage/v.py", "class VectorStore:\n    pass\n")
    assert not lint.check_file("packages/storage/storage/v.py",
                               "from tenant_context import TenantScopedStore\n"
                               "class VectorStore(TenantScopedStore):\n    pass\n")


def test_repository_passes_the_lint():
    lint = _lint()
    assert lint.main() == 0
