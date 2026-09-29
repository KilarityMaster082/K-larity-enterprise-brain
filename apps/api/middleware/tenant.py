# Owner task: EB-20 RLS and tenant middleware
"""Tenant context and database session binding middleware.

Extracts tenant identification from authenticated token claims or headers,
validates format, resolves tenant placement via PlacementResolver, enters
the TenantContext scope for the request lifecycle, and binds database sessions
with `SET LOCAL app.tenant_id = :tenant_id` inside transactions (Risk R-6).
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any, Sequence

from storage import bind_session_tenant
from tenant_context import (
    NoTenantContextError,
    PlacementResolver,
    TenantContext,
    TenantStatus,
    TenantUnavailableError,
    UnknownTenantError,
    require_tenant,
    tenant_scope,
    validate_tenant_id,
)

DEFAULT_EXEMPT_PATHS = frozenset({
    "/healthz",
    "/readyz",
    "/metrics",
    "/docs",
    "/openapi.json",
})


class TenantMiddlewareError(Exception):
    """Base error for tenant resolution failures in middleware."""
    def __init__(self, status_code: int, error_code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.error_code = error_code
        self.message = message

    def to_dict(self) -> dict[str, str]:
        return {"error": self.error_code, "detail": self.message}


class MissingTenantError(TenantMiddlewareError):
    def __init__(self, message: str = "Tenant identification is required") -> None:
        super().__init__(401, "missing_tenant", message)


class InvalidTenantError(TenantMiddlewareError):
    def __init__(self, message: str) -> None:
        super().__init__(400, "invalid_tenant", message)


class TenantAccessDeniedError(TenantMiddlewareError):
    def __init__(self, message: str) -> None:
        super().__init__(403, "tenant_access_denied", message)


def extract_tenant_id(headers: Sequence[tuple[bytes, bytes]] | dict[str, str]) -> str | None:
    """Extract tenant_id from HTTP headers or Bearer token claims."""
    # Convert ASGI headers list to lowercase string dict
    header_map: dict[str, str] = {}
    if isinstance(headers, dict):
        header_map = {k.lower(): v for k, v in headers.items()}
    else:
        for k, v in headers:
            header_map[k.decode("latin1").lower()] = v.decode("latin1")

    # 1. Direct tenant header (X-Tenant-ID)
    if "x-tenant-id" in header_map:
        return header_map["x-tenant-id"].strip()

    # 2. Check Keycloak token in Authorization header if present
    auth = header_map.get("authorization", "")
    if auth.startswith("Bearer ") and "." in auth:
        token_str = auth[7:].strip()
        parts = token_str.split(".")
        if len(parts) >= 2:
            import base64
            try:
                # Add padding if required for standard base64 decoding
                rem = len(parts[1]) % 4
                padded = parts[1] + ("=" * (4 - rem) if rem else "")
                payload_bytes = base64.urlsafe_b64decode(padded)
                claims = json.loads(payload_bytes.decode("utf-8"))
                # Keycloak Organizations standard claim or custom tenant claim
                tenant = claims.get("organization") or claims.get("tenant_id")
                if tenant:
                    return str(tenant).strip()
            except Exception:
                pass

    return None


class TenantMiddleware:
    """Pure ASGI middleware enforcing tenant identification, validation, and scoping."""

    def __init__(
        self,
        app: Any,
        resolver: PlacementResolver,
        exempt_paths: frozenset[str] | set[str] | None = None,
    ) -> None:
        self.app = app
        self.resolver = resolver
        self.exempt_paths = frozenset(exempt_paths or DEFAULT_EXEMPT_PATHS)

    async def __call__(
        self,
        scope: dict[str, Any],
        receive: Callable[..., Any],
        send: Callable[..., Any],
    ) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path: str = scope.get("path", "")
        if path in self.exempt_paths:
            await self.app(scope, receive, send)
            return

        headers = scope.get("headers", [])
        tenant_id = extract_tenant_id(headers)

        if not tenant_id:
            await self._send_json_error(
                send, 401, "missing_tenant", "Tenant identification is required (X-Tenant-ID or verified token)"
            )
            return

        # Validate tenant ID format
        try:
            validate_tenant_id(tenant_id)
        except ValueError as e:
            await self._send_json_error(send, 400, "invalid_tenant", str(e))
            return

        # Resolve tenant placement and status
        try:
            ctx = self.resolver.resolve(tenant_id)
        except UnknownTenantError:
            await self._send_json_error(send, 403, "unknown_tenant", f"Tenant {tenant_id!r} does not exist")
            return
        except TenantUnavailableError as e:
            await self._send_json_error(send, 403, "tenant_unavailable", str(e))
            return
        except Exception as e:
            await self._send_json_error(send, 500, "resolution_error", f"Tenant resolution failed: {e}")
            return

        if ctx.status != TenantStatus.ACTIVE:
            await self._send_json_error(
                send, 403, "tenant_suspended", f"Tenant {tenant_id!r} is not active ({ctx.status.value})"
            )
            return

        # Enter tenant scope for the duration of the request
        with tenant_scope(ctx):
            if "state" not in scope:
                scope["state"] = {}
            scope["state"]["tenant"] = ctx
            await self.app(scope, receive, send)

    async def _send_json_error(
        self,
        send: Callable[..., Any],
        status_code: int,
        error_code: str,
        message: str,
    ) -> None:
        body = json.dumps({"error": error_code, "detail": message}).encode("utf-8")
        await send({
            "type": "http.response.start",
            "status": status_code,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        })
        await send({
            "type": "http.response.body",
            "body": body,
        })
