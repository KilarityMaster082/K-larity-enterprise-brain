"""Owner task: EB-85 Tenant registry and control plane — shared fixtures for store tests."""

from __future__ import annotations

import pytest

from tenant_context import Placement, TenantContext, TenantStatus, Tier


def make_ctx(tenant_id: str) -> TenantContext:
    p = Placement(cell_id="c1", region="ap-south-2", pg_cluster="pg", pg_database="brain", object_bucket="bkt",
                  object_prefix=f"tenants/{tenant_id}/", qdrant_cluster="q", qdrant_shard_key="pool",
                  opensearch_cluster="os", opensearch_index="docs", opensearch_alias=f"tenant-{tenant_id}",
                  fga_store="fga", temporal_namespace="c1", temporal_queue_prefix="pool",
                  litellm_team=f"tenant-{tenant_id}", kms_key_ref=f"alias/klarity-tenant-{tenant_id}")
    return TenantContext(tenant_id, tenant_id, TenantStatus.ACTIVE, Tier.POOL, p)


@pytest.fixture
def ctx():
    """Factory: ctx("tenant-a") -> an ACTIVE pool TenantContext for that tenant."""
    return make_ctx
