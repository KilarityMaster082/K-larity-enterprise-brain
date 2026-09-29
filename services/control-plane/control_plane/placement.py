"""Placement policy: the one place that turns (tenant, tier, cell) into concrete store locations.

Owner task: EB-85 Tenant registry and control plane
Borrowed from: Dify a4f949f (pattern only, no code) — per-tenant resources created at onboarding (D1–D3);
Onyx ee tenant provisioning (pattern only, O11). Tier rules follow research/foundation-fit.md §4.1 and
§4.3: pool shares everything and isolates logically; bridge gets its own Qdrant shard key, OpenSearch
index, Postgres database and Temporal queues inside the shared cell; silo gets a dedicated cell.
The result is stored in the registry. Data-plane code reads the stored Placement and never looks at tier.
"""

from __future__ import annotations

from dataclasses import dataclass

from tenant_context import Placement, Tier, validate_tenant_id

POOL_PG_DATABASE = "brain"
POOL_QDRANT_SHARD_KEY = "pool"
POOL_OPENSEARCH_INDEX = "docs"
POOL_TEMPORAL_QUEUE_PREFIX = "pool"


class CellKind:
    SHARED = "shared"        # pool and bridge tenants
    DEDICATED = "dedicated"  # exactly one silo tenant


@dataclass(frozen=True)
class Cell:
    """One full copy of the stack. Values are resource names; endpoints and secrets live in deploy config."""

    cell_id: str
    region: str
    kind: str
    pg_cluster: str
    object_bucket: str
    qdrant_cluster: str
    opensearch_cluster: str
    fga_store: str
    temporal_namespace: str
    status: str = "active"

    def __post_init__(self) -> None:
        if self.kind not in (CellKind.SHARED, CellKind.DEDICATED):
            raise ValueError(f"unknown cell kind {self.kind!r}")


def place(tenant_id: str, tier: Tier, cell: Cell) -> Placement:
    validate_tenant_id(tenant_id)
    if (tier is Tier.SILO) != (cell.kind == CellKind.DEDICATED):
        raise ValueError(f"{tier.value} tenant cannot be placed in a {cell.kind} cell")
    dedicated = tier is not Tier.POOL
    return Placement(
        cell_id=cell.cell_id,
        region=cell.region,
        pg_cluster=cell.pg_cluster,
        pg_database=f"brain_{tenant_id.replace('-', '_')}" if dedicated else POOL_PG_DATABASE,
        object_bucket=cell.object_bucket,
        object_prefix=f"tenants/{tenant_id}/",
        qdrant_cluster=cell.qdrant_cluster,
        qdrant_shard_key=tenant_id if dedicated else POOL_QDRANT_SHARD_KEY,
        opensearch_cluster=cell.opensearch_cluster,
        opensearch_index=f"docs-{tenant_id}" if dedicated else POOL_OPENSEARCH_INDEX,
        opensearch_alias=f"tenant-{tenant_id}",
        fga_store=cell.fga_store,
        temporal_namespace=cell.temporal_namespace,
        temporal_queue_prefix=f"t-{tenant_id}" if dedicated else POOL_TEMPORAL_QUEUE_PREFIX,
        litellm_team=f"tenant-{tenant_id}",
        kms_key_ref=f"alias/klarity-tenant-{tenant_id}",
    )
