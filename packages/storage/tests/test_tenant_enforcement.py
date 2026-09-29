# Owner task: EB-20 RLS and tenant middleware
"""Unit tests for tenant enforcement across VectorStore and SearchStore.

Validates that:
1. Stores refuse execution when no active TenantContext is present (NoTenantContextError).
2. Stores prevent cross-tenant writes (CrossTenantAccessError).
3. Search and vector queries automatically inject tenant filters and placement keys.
"""

from __future__ import annotations

import pytest
from storage.search_store import LocalSearchBackend, SearchStore
from storage.vector_store import LocalVectorBackend, VectorPoint, VectorStore
from tenant_context import (
    CrossTenantAccessError,
    NoTenantContextError,
    Placement,
    TenantContext,
    TenantStatus,
    Tier,
    tenant_scope,
)


def _make_ctx(tenant_id: str) -> TenantContext:
    p = Placement(
        cell_id="c1",
        region="ap-south-2",
        pg_cluster="pg",
        pg_database="brain",
        object_bucket="klarity-pool-bucket",
        object_prefix=f"tenants/{tenant_id}/",
        qdrant_cluster="q",
        qdrant_shard_key=tenant_id,
        opensearch_cluster="os",
        opensearch_index=f"klarity-{tenant_id}",
        opensearch_alias="klarity-pool-alias",
        fga_store="fga",
        temporal_namespace="c1",
        temporal_queue_prefix="pool",
        litellm_team=f"tenant-{tenant_id}",
        kms_key_ref=f"alias/klarity-tenant-{tenant_id}",
    )
    return TenantContext(
        tenant_id=tenant_id,
        slug=tenant_id,
        status=TenantStatus.ACTIVE,
        tier=Tier.POOL,
        placement=p,
    )


@pytest.fixture
def tenant_a() -> TenantContext:
    return _make_ctx("tenant-alpha")


@pytest.fixture
def tenant_b() -> TenantContext:
    return _make_ctx("tenant-beta")


def test_vector_store_requires_tenant_context() -> None:
    backend = LocalVectorBackend()
    store = VectorStore(backend)

    with pytest.raises(NoTenantContextError):
        store.upsert([VectorPoint(id="p1", vector=[0.1, 0.2])])

    with pytest.raises(NoTenantContextError):
        store.search(query_vector=[0.1, 0.2])

    with pytest.raises(NoTenantContextError):
        store.count()

    with pytest.raises(NoTenantContextError):
        store.delete(["p1"])


def test_vector_store_isolation_and_filter_injection(tenant_a: TenantContext, tenant_b: TenantContext) -> None:
    backend = LocalVectorBackend()
    store = VectorStore(backend)

    # Tenant A upserts a point
    with tenant_scope(tenant_a):
        store.upsert([
            VectorPoint(id="doc-1", vector=[1.0, 0.0], payload={"title": "Doc Alpha"}),
        ])
        assert store.count() == 1
        results = store.search(query_vector=[1.0, 0.0])
        assert len(results) == 1
        assert results[0].id == "doc-1"
        assert results[0].payload["tenant_id"] == "tenant-alpha"

    # Tenant B should see 0 points (shard and tenant filter isolation)
    with tenant_scope(tenant_b):
        assert store.count() == 0
        results = store.search(query_vector=[1.0, 0.0])
        assert len(results) == 0

        # Tenant B adds their own point
        store.upsert([
            VectorPoint(id="doc-2", vector=[1.0, 0.0], payload={"title": "Doc Beta"}),
        ])
        assert store.count() == 1

    # Back to Tenant A: still sees only 1 point
    with tenant_scope(tenant_a):
        assert store.count() == 1
        results = store.search(query_vector=[1.0, 0.0])
        assert len(results) == 1
        assert results[0].id == "doc-1"


def test_vector_store_cross_tenant_injection_refused(tenant_a: TenantContext) -> None:
    backend = LocalVectorBackend()
    store = VectorStore(backend)

    with tenant_scope(tenant_a):
        # Attempting to insert a point with mismatched foreign tenant_id
        with pytest.raises(CrossTenantAccessError) as exc_info:
            store.upsert([
                VectorPoint(id="doc-bad", vector=[0.5, 0.5], payload={"tenant_id": "tenant-beta"}),
            ])
        assert "foreign tenant_id 'tenant-beta'" in str(exc_info.value)


def test_search_store_requires_tenant_context() -> None:
    backend = LocalSearchBackend()
    store = SearchStore(backend)

    with pytest.raises(NoTenantContextError):
        store.index(doc_id="d1", document={"text": "Hello"})

    with pytest.raises(NoTenantContextError):
        store.search(query={"match": {"text": "Hello"}})

    with pytest.raises(NoTenantContextError):
        store.count()

    with pytest.raises(NoTenantContextError):
        store.delete(doc_id="d1")


def test_search_store_isolation_and_filter_injection(tenant_a: TenantContext, tenant_b: TenantContext) -> None:
    backend = LocalSearchBackend()
    store = SearchStore(backend)

    # Tenant A indexes document
    with tenant_scope(tenant_a):
        store.index(doc_id="doc-a1", document={"text": "Architectural Foundation Blueprint"})
        assert store.count() == 1
        res = store.search(query={"match": {"text": "Architectural"}})
        assert len(res) == 1
        assert res[0]["tenant_id"] == "tenant-alpha"

    # Tenant B queries: returns 0 documents
    with tenant_scope(tenant_b):
        assert store.count() == 0
        res = store.search(query={"match": {"text": "Architectural"}})
        assert len(res) == 0

        # Tenant B indexes their own document
        store.index(doc_id="doc-b1", document={"text": "Electrical Specifications"})
        assert store.count() == 1

    # Back to Tenant A: only sees Tenant A's document
    with tenant_scope(tenant_a):
        assert store.count() == 1
        res = store.search(query={"match": {"text": "Architectural"}})
        assert len(res) == 1
        assert res[0]["text"] == "Architectural Foundation Blueprint"


def test_search_store_cross_tenant_injection_refused(tenant_a: TenantContext) -> None:
    backend = LocalSearchBackend()
    store = SearchStore(backend)

    with tenant_scope(tenant_a):
        with pytest.raises(CrossTenantAccessError) as exc_info:
            store.index(doc_id="doc-evil", document={"tenant_id": "tenant-beta", "text": "Leaked data"})
        assert "foreign tenant_id 'tenant-beta'" in str(exc_info.value)
