"""Store guard: every public method of a store wrapper runs only inside a tenant scope.

Owner task: EB-85 Tenant registry and control plane
Subclass TenantScopedStore and every public method is wrapped automatically: it raises
NoTenantContextError outside a scope, and CrossTenantAccessError if its `tenant_id` argument names a
different tenant from the active one. ops/ci/check_tenant_scope.py makes sure store wrappers use this
base and that raw database / object-store / index clients are imported only inside store wrappers.
"""

from __future__ import annotations

import functools
import inspect
from collections.abc import Callable
from typing import Any, TypeVar

from .context import Placement, TenantContext, current_tenant, require_tenant

F = TypeVar("F", bound=Callable[..., Any])


def tenant_scoped(fn: F) -> F:
    if getattr(fn, "__tenant_scoped__", False):
        return fn
    sig = inspect.signature(fn)
    takes_tenant = "tenant_id" in sig.parameters

    @functools.wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        if takes_tenant:
            require_tenant(sig.bind(*args, **kwargs).arguments["tenant_id"])
        else:
            current_tenant()
        return fn(*args, **kwargs)

    wrapper.__tenant_scoped__ = True  # type: ignore[attr-defined]
    return wrapper  # type: ignore[return-value]


class TenantScopedStore:
    """Base class for store wrappers. Read placement via `self._placement()`, never from arguments."""

    def __init_subclass__(cls, **kwargs: Any) -> None:
        super().__init_subclass__(**kwargs)
        for name, attr in list(vars(cls).items()):
            if name.startswith("_") or not inspect.isfunction(attr):
                continue
            setattr(cls, name, tenant_scoped(attr))

    @staticmethod
    def _tenant() -> TenantContext:
        return current_tenant()

    @staticmethod
    def _placement() -> Placement:
        return current_tenant().placement
