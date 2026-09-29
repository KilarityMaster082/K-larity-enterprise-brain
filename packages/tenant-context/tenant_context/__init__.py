"""K!larity tenant context: the active tenant, its placement, and the store guard.

Owner task: EB-85 Tenant registry and control plane
"""

from .context import (
    CrossTenantAccessError,
    NoTenantContextError,
    Placement,
    TenantContext,
    TenantContextError,
    TenantStatus,
    TenantUnavailableError,
    Tier,
    UnknownTenantError,
    current_tenant,
    current_tenant_or_none,
    require_tenant,
    tenant_scope,
    validate_tenant_id,
)
from .guard import TenantScopedStore, tenant_scoped
from .resolver import ACTIVE_ONLY, PlacementResolver, TenantDirectory

__all__ = [
    "ACTIVE_ONLY", "CrossTenantAccessError", "NoTenantContextError", "Placement", "PlacementResolver",
    "TenantContext", "TenantContextError", "TenantDirectory", "TenantScopedStore", "TenantStatus",
    "TenantUnavailableError", "Tier", "UnknownTenantError", "current_tenant", "current_tenant_or_none",
    "require_tenant", "tenant_scope", "tenant_scoped", "validate_tenant_id",
]
