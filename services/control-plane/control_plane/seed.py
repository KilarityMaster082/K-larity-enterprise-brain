"""Day-one tenants: Studio 8 Hats (pool) and a synthetic canary tenant, in one pool cell.

Owner task: EB-85 Tenant registry and control plane
Mirrors db/seed/tenants.sql (a test keeps the two in step). The synthetic tenant exists from day one so
every cross-tenant test has a real second tenant to leak into (research/foundation-fit.md §4.6).
Tenants are left in PROVISIONING unless `activate=True`; in production ProvisionTenant activates them.
"""

from __future__ import annotations

from tenant_context import TenantStatus, Tier

from .placement import Cell, CellKind
from .registry import FileTenantRegistry, Tenant

POOL_CELL = Cell(
    cell_id="pool-in-1",
    region="ap-south-2",
    kind=CellKind.SHARED,
    pg_cluster="pg-pool-in-1",
    object_bucket="klarity-pool-in-1",
    qdrant_cluster="qdrant-pool-in-1",
    opensearch_cluster="os-pool-in-1",
    fga_store="fga-pool-in-1",
    temporal_namespace="pool-in-1",
)

STUDIO8_ID = "0fdc5142-8c25-41c5-aab4-0a88db52a5bf"
SYNTHETIC_ID = "1bae9ff8-abf9-44bf-9b17-a5cb2c83d71b"

DAY_ONE_TENANTS = (
    dict(tenant_id=STUDIO8_ID, slug="studio8", display_name="Studio 8 Hats", tier=Tier.POOL, plan="pilot",
         cell_id=POOL_CELL.cell_id, is_synthetic=False),
    dict(tenant_id=SYNTHETIC_ID, slug="synthetic-canary", display_name="Synthetic canary tenant",
         tier=Tier.POOL, plan="pilot", cell_id=POOL_CELL.cell_id, is_synthetic=True),
)


def seed(registry: FileTenantRegistry, *, activate: bool = False) -> list[Tenant]:
    registry.add_cell(POOL_CELL)
    out = [registry.register(**spec) for spec in DAY_ONE_TENANTS]
    if activate:
        out = [registry.set_status(t.tenant_id, TenantStatus.ACTIVE) for t in out]
    return out
