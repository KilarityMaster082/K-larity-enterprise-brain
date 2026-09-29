"""Owner task: EB-85 Tenant registry and control plane — tenant-scoped object store tests."""

from __future__ import annotations

import pytest

from storage import LocalObjectBackend, ObjectStore
from tenant_context import NoTenantContextError, Placement, TenantContext, TenantStatus, Tier, tenant_scope


def ctx(tenant_id: str) -> TenantContext:
    p = Placement(cell_id="c1", region="ap-south-2", pg_cluster="pg", pg_database="brain", object_bucket="bkt",
                  object_prefix=f"tenants/{tenant_id}/", qdrant_cluster="q", qdrant_shard_key="pool",
                  opensearch_cluster="os", opensearch_index="docs", opensearch_alias=f"tenant-{tenant_id}",
                  fga_store="fga", temporal_namespace="c1", temporal_queue_prefix="pool",
                  litellm_team=f"tenant-{tenant_id}", kms_key_ref=f"alias/klarity-tenant-{tenant_id}")
    return TenantContext(tenant_id, tenant_id, TenantStatus.ACTIVE, Tier.POOL, p)


@pytest.fixture
def store(tmp_path):
    return ObjectStore(LocalObjectBackend(tmp_path)), tmp_path


def test_keys_land_under_the_tenant_prefix(store):
    s, root = store
    with tenant_scope(ctx("tenant-a")):
        s.put("raw/doc.txt", b"hello")
        assert s.get("raw/doc.txt") == b"hello" and s.exists("raw/doc.txt")
        assert s.list() == ["raw/doc.txt"] and s.list("raw/") == ["raw/doc.txt"]
    assert (root / "bkt/tenants/tenant-a/raw/doc.txt").read_bytes() == b"hello"


def test_same_key_is_isolated_per_tenant(store):
    s, _ = store
    with tenant_scope(ctx("tenant-a")):
        s.put("k", b"a")
    with tenant_scope(ctx("tenant-b")):
        assert not s.exists("k") and s.list() == []
        s.put("k", b"b")
    with tenant_scope(ctx("tenant-a")):
        assert s.get("k") == b"a"
        s.delete("k")
        assert not s.exists("k")
    with tenant_scope(ctx("tenant-b")):
        assert s.get("k") == b"b"


@pytest.mark.parametrize("key", ["", "/abs", "../tenant-b/k", "a/../../tenant-b/k", "a//b", "a/./b", "a\\b"])
def test_traversal_and_malformed_keys_are_rejected(store, key):
    s, _ = store
    with tenant_scope(ctx("tenant-a")):
        with pytest.raises(ValueError):
            s.put(key, b"x")


def test_list_prefix_cannot_climb_out(store):
    s, _ = store
    with tenant_scope(ctx("tenant-a")):
        with pytest.raises(ValueError):
            s.list("../")


def test_every_call_needs_a_context(store):
    s, _ = store
    for call in (lambda: s.put("k", b"x"), lambda: s.get("k"), lambda: s.exists("k"),
                 lambda: s.delete("k"), s.list):
        with pytest.raises(NoTenantContextError):
            call()
