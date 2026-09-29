"""TenantContext: which tenant this unit of work is for, and where that tenant's data lives.

Owner task: EB-85 Tenant registry and control plane
Borrowed from: Onyx a18fc1a backend/shared_configs/contextvars.py (MIT) — a ContextVar carries the current
tenant through every layer; reading it when unset is an error. Adapted: the variable holds the whole
resolved TenantContext (placement included), not a bare id; there is no single-tenant default (Onyx falls
back to a default schema) so a missing context always fails closed; entering a scope for a second tenant
while one is active is refused, so a job for tenant A cannot quietly act for tenant B.
"""

from __future__ import annotations

import contextvars
import re
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass, fields
from enum import Enum

# Lowercase so the id is valid unchanged in every store name (OpenSearch index, Temporal queue, KMS alias).
_TENANT_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}$")


class TenantContextError(Exception):
    pass


class NoTenantContextError(TenantContextError):
    """A tenant-scoped operation ran outside `tenant_scope`."""


class CrossTenantAccessError(TenantContextError):
    """An operation named a tenant other than the one in the active context."""


class UnknownTenantError(TenantContextError):
    """The registry has no such tenant."""


class TenantUnavailableError(TenantContextError):
    """The tenant exists but its status does not allow this operation (e.g. suspended)."""


def validate_tenant_id(value: str) -> str:
    if not isinstance(value, str) or not _TENANT_ID_RE.match(value):
        raise ValueError(f"invalid tenant_id: {value!r}")
    return value


class Tier(str, Enum):
    POOL = "pool"      # shared cell, logical isolation
    BRIDGE = "bridge"  # shared cell, dedicated shard / index / queue / database
    SILO = "silo"      # dedicated cell


class TenantStatus(str, Enum):
    PROVISIONING = "provisioning"
    ACTIVE = "active"
    SUSPENDED = "suspended"
    OFFBOARDING = "offboarding"
    OFFBOARDED = "offboarded"


@dataclass(frozen=True)
class Placement:
    """Where one tenant's data lives. Store wrappers read these values; none of them branch on tier."""

    cell_id: str
    region: str
    pg_cluster: str           # cluster name; the DSN is resolved from the secret store, never kept here
    pg_database: str
    object_bucket: str
    object_prefix: str        # always "tenants/<tenant_id>/"
    qdrant_cluster: str
    qdrant_shard_key: str
    opensearch_cluster: str
    opensearch_index: str
    opensearch_alias: str
    fga_store: str
    temporal_namespace: str
    temporal_queue_prefix: str
    litellm_team: str
    kms_key_ref: str
    keycloak_org_id: str | None = None  # set by ProvisionTenant once the organization exists

    def to_resources(self) -> dict[str, str]:
        """Rows for db/control tenant_resources (kind -> ref); unset values are omitted."""
        return {f.name: v for f in fields(self) if (v := getattr(self, f.name)) is not None}

    @classmethod
    def from_resources(cls, resources: Mapping[str, str]) -> Placement:
        known = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in resources.items() if k in known})


@dataclass(frozen=True)
class TenantContext:
    tenant_id: str
    slug: str
    status: TenantStatus
    tier: Tier
    placement: Placement

    def __post_init__(self) -> None:
        validate_tenant_id(self.tenant_id)
        # The prefix is the one placement value a mistake could point at another tenant's data.
        if self.placement.object_prefix != f"tenants/{self.tenant_id}/":
            raise ValueError(f"placement object_prefix {self.placement.object_prefix!r} "
                             f"does not belong to tenant {self.tenant_id!r}")


_CURRENT: contextvars.ContextVar[TenantContext | None] = contextvars.ContextVar("klarity_tenant", default=None)


def current_tenant() -> TenantContext:
    ctx = _CURRENT.get()
    if ctx is None:
        raise NoTenantContextError("no tenant context: wrap the work in tenant_scope(...) or resolver.scope(...)")
    return ctx


def current_tenant_or_none() -> TenantContext | None:
    return _CURRENT.get()


def require_tenant(tenant_id: str) -> TenantContext:
    """The active context, provided it is for `tenant_id`."""
    ctx = current_tenant()
    if ctx.tenant_id != tenant_id:
        raise CrossTenantAccessError(f"active tenant is {ctx.tenant_id!r}, operation named {tenant_id!r}")
    return ctx


@contextmanager
def tenant_scope(ctx: TenantContext) -> Iterator[TenantContext]:
    """Run the block as `ctx`. Re-entering for the same tenant is allowed; switching tenant is not."""
    active = _CURRENT.get()
    if active is not None and active.tenant_id != ctx.tenant_id:
        raise CrossTenantAccessError(f"already scoped to {active.tenant_id!r}; cannot enter {ctx.tenant_id!r}")
    token = _CURRENT.set(ctx)
    try:
        yield ctx
    finally:
        _CURRENT.reset(token)
