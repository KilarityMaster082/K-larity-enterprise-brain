"""Placement resolver: tenant_id -> TenantContext, read from the tenant registry and briefly cached.

Owner task: EB-85 Tenant registry and control plane
Every entry point (API middleware, Temporal activity, CLI) turns a tenant_id into a context here and runs
its work inside `resolver.scope(...)`. Only ACTIVE tenants resolve by default, so a suspended tenant stops
being served within `ttl_seconds`; the offboarding workflow calls `invalidate` to make it immediate.
Misses are not cached, so a newly registered tenant is visible at once.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Protocol

from .context import (
    TenantContext,
    TenantStatus,
    TenantUnavailableError,
    UnknownTenantError,
    tenant_scope,
    validate_tenant_id,
)

ACTIVE_ONLY = frozenset({TenantStatus.ACTIVE})


class TenantDirectory(Protocol):
    """Implemented by the control-plane registry (services/control-plane)."""

    def lookup(self, tenant_id: str) -> TenantContext | None: ...


class PlacementResolver:
    def __init__(self, directory: TenantDirectory, *, ttl_seconds: float = 30.0,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self._directory = directory
        self._ttl = ttl_seconds
        self._clock = clock
        self._cache: dict[str, tuple[float, TenantContext]] = {}
        self._lock = threading.Lock()

    def resolve(self, tenant_id: str, *, allow: frozenset[TenantStatus] = ACTIVE_ONLY) -> TenantContext:
        validate_tenant_id(tenant_id)
        now = self._clock()
        with self._lock:
            hit = self._cache.get(tenant_id)
        if hit is not None and now - hit[0] < self._ttl:
            ctx = hit[1]
        else:
            found = self._directory.lookup(tenant_id)
            if found is None:
                raise UnknownTenantError(f"unknown tenant {tenant_id!r}")
            ctx = found
            with self._lock:
                self._cache[tenant_id] = (now, ctx)
        if ctx.status not in allow:
            raise TenantUnavailableError(f"tenant {tenant_id!r} is {ctx.status.value}")
        return ctx

    @contextmanager
    def scope(self, tenant_id: str, *, allow: frozenset[TenantStatus] = ACTIVE_ONLY) -> Iterator[TenantContext]:
        with tenant_scope(self.resolve(tenant_id, allow=allow)) as ctx:
            yield ctx

    def invalidate(self, tenant_id: str | None = None) -> None:
        with self._lock:
            if tenant_id is None:
                self._cache.clear()
            else:
                self._cache.pop(tenant_id, None)
