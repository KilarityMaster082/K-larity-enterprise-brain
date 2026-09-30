# Owner task: EB-42 Permission filtering before retrieval
"""Permission filter: pre-retrieval scope, post-retrieval re-check, deny by default, tenant isolation."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest

from packages.permissions import PermissionsClient
from packages.permissions.filter import PermissionFilter
from storage import FgaStore, LocalFgaBackend, TupleKey
from tenant_context import Placement, TenantContext, TenantStatus, Tier, tenant_scope


def _ctx(tenant_id: str) -> TenantContext:
    p = Placement(
        cell_id="c1", region="ap-south-2", pg_cluster="pg", pg_database="brain",
        object_bucket="b", object_prefix=f"tenants/{tenant_id}/", qdrant_cluster="q",
        qdrant_shard_key=tenant_id, opensearch_cluster="os", opensearch_index=f"klarity-{tenant_id}",
        opensearch_alias="alias", fga_store=f"fga-{tenant_id}", temporal_namespace="c1",
        temporal_queue_prefix="pool", litellm_team=f"t-{tenant_id}", kms_key_ref=f"alias/{tenant_id}",
    )
    return TenantContext(tenant_id=tenant_id, slug=tenant_id, status=TenantStatus.ACTIVE, tier=Tier.POOL, placement=p)


@dataclass
class Cand:
    document_id: str
    project_id: str | None = None
    source_metadata: dict[str, Any] = field(default_factory=dict)


@pytest.fixture
def world():
    backend = LocalFgaBackend()
    store = FgaStore(backend, cache_ttl_seconds=0)
    writes = [
        TupleKey("user:asha", "member", "project:phoenix"),
        TupleKey("tenant:studio8", "parent", "project:phoenix"),
        TupleKey("project:phoenix", "parent", "document:d-phoenix"),
        TupleKey("project:harbour", "parent", "document:d-harbour"),
        TupleKey("user:asha", "viewer", "document:d-shared"),
    ]
    with tenant_scope(_ctx("studio8")):
        store.write_tuples(writes, [])
    return PermissionFilter(PermissionsClient(store)), backend


def test_scope_lists_only_permitted_projects_and_documents(world) -> None:
    pf, _ = world
    with tenant_scope(_ctx("studio8")):
        scope = pf.scope_for("asha")
    assert scope.tenant_id == "studio8"
    assert scope.project_ids == {"phoenix"}
    assert "d-shared" in scope.document_ids and "d-harbour" not in scope.document_ids


def test_filter_spec_shapes(world) -> None:
    pf, _ = world
    with tenant_scope(_ctx("studio8")):
        both = pf.scope_for("asha").filter_spec()
        nobody = pf.scope_for("nobody").filter_spec()
    assert "should" in both and {c["key"] for c in both["should"]} == {"project_id", "document_id"}
    # Empty scope matches no real chunk rather than everything.
    assert nobody == {"must": [{"key": "project_id", "match": {"any": ["__no_access__"]}}]}


def test_authorize_drops_forbidden_and_keeps_order(world) -> None:
    pf, _ = world
    cands = [
        Cand("d-harbour", "harbour"),
        Cand("d-phoenix", "phoenix"),
        Cand("d-shared", None),
    ]
    with tenant_scope(_ctx("studio8")):
        out = pf.authorize("asha", cands)
    assert [c.document_id for c in out] == ["d-phoenix", "d-shared"]


def test_deny_by_default_without_identity(world) -> None:
    pf, _ = world
    with tenant_scope(_ctx("studio8")):
        assert pf.authorize("asha", [Cand("", None)]) == []


def test_foreign_tenant_candidate_dropped_even_if_ids_match(world) -> None:
    pf, _ = world
    with tenant_scope(_ctx("studio8")):
        out = pf.authorize("asha", [Cand("d-phoenix", "phoenix", {"tenant_id": "other"})])
    assert out == []


def test_permissions_do_not_cross_tenants(world) -> None:
    pf, _ = world
    with tenant_scope(_ctx("synthetic")):
        assert pf.scope_for("asha").is_empty
        assert pf.authorize("asha", [Cand("d-phoenix", "phoenix")]) == []
