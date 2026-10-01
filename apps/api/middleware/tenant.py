# Owner task: EB-20 RLS and tenant middleware
"""Tenant context and database session binding middleware.

Extracts tenant identification from authenticated token claims or headers,
validates format, resolves tenant placement via PlacementResolver, enters
the TenantContext scope for the request lifecycle, and binds database sessions
with `SET LOCAL app.tenant_id = :tenant_id` inside transactions (Risk R-6).
"""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Sequence

from apps.api.auth.token_verifier import KeycloakTokenVerifier, TokenError

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

logger = logging.getLogger(__name__)

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


@dataclass(frozen=True)
class RequestUser:
    """Who is calling. In production this only ever comes from a signature-verified token."""

    user_id: str
    roles: tuple[str, ...] = ()
    verified: bool = False


def _header_map(headers: Sequence[tuple[bytes, bytes]] | dict[str, str]) -> dict[str, str]:
    if isinstance(headers, dict):
        return {k.lower(): v for k, v in headers.items()}
    return {k.decode("latin1").lower(): v.decode("latin1") for k, v in headers}


def extract_tenant_id(headers: Sequence[tuple[bytes, bytes]] | dict[str, str]) -> str | None:
    """UNTRUSTED tenant hint from a header or an unverified token payload — development mode only.

    Production never calls this: the tenant comes from a verified token (see TenantMiddleware._identify).
    """
    # Convert ASGI headers list to lowercase string dict
    header_map = _header_map(headers)

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
        verifier: KeycloakTokenVerifier | None = None,
        auth_mode: str | None = None,
    ) -> None:
        """``auth_mode``: "production" (default, also from KLARITY_AUTH_MODE) trusts only a verified bearer token;
        "development" additionally accepts X-Tenant-ID / X-User-ID headers and is refused when KLARITY_ENV=production.
        """
        mode = auth_mode or os.environ.get("KLARITY_AUTH_MODE", "production")
        if mode not in ("production", "development"):
            raise ValueError(f"unknown auth_mode: {mode!r}")
        if mode == "development" and os.environ.get("KLARITY_ENV") == "production":
            raise RuntimeError("development auth mode is refused when KLARITY_ENV=production")
        self.app = app
        self.resolver = resolver
        self.exempt_paths = frozenset(exempt_paths or DEFAULT_EXEMPT_PATHS)
        self.verifier = verifier
        self.auth_mode = mode
        if mode == "development":
            logger.warning("API running in DEVELOPMENT auth mode: tenant and user are taken from unauthenticated headers")

    def _identify(self, headers: Any) -> tuple[str, RequestUser | None] | TenantMiddlewareError:
        """Resolve (tenant_id, user). Production: verified token only, header may only *select* a tenant the token grants."""
        hm = _header_map(headers)
        if self.auth_mode == "development":
            tenant = extract_tenant_id(headers)
            if not tenant:
                return MissingTenantError("Tenant identification is required (X-Tenant-ID or token)")
            uid = hm.get("x-user-id", "").strip()
            return tenant, (RequestUser(uid, tuple(r for r in hm.get("x-user-roles", "").split(",") if r)) if uid else None)

        auth = hm.get("authorization", "")
        if not auth.startswith("Bearer "):
            return MissingTenantError("A bearer token is required")
        if self.verifier is None:
            return TenantMiddlewareError(503, "auth_not_configured", "Token verification is not configured")
        try:
            verified = self.verifier.verify(auth[7:].strip())
        except TokenError as e:
            return TenantMiddlewareError(401, "invalid_token", str(e))
        granted = [t for t in dict.fromkeys([verified.tenant_id or "", *verified.organizations]) if t]
        if not granted:
            return TenantAccessDeniedError("Token grants no tenant")
        requested = hm.get("x-tenant-id", "").strip()
        if requested:
            if requested not in granted:
                return TenantAccessDeniedError("Token does not grant the requested tenant")
            tenant = requested
        elif len(granted) == 1:
            tenant = granted[0]
        else:
            return InvalidTenantError("Token grants several tenants; select one with X-Tenant-ID")
        return tenant, RequestUser(verified.sub, tuple(verified.roles), True)

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

        identified = self._identify(scope.get("headers", []))
        if isinstance(identified, TenantMiddlewareError):
            await self._send_json_error(send, identified.status_code, identified.error_code, identified.message)
            return
        tenant_id, user = identified

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
            scope["state"]["user"] = user
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
