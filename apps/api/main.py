# Owner task: EB-20 RLS and tenant middleware
"""K!larity Enterprise Brain API composition root.

Assembles HTTP endpoints, health checks, and the TenantMiddleware to enforce
tenant isolation across all incoming requests.
"""

from __future__ import annotations

import json
from typing import Any, Callable

from apps.api.middleware.tenant import TenantMiddleware
from tenant_context import PlacementResolver, current_tenant


async def healthz_handler(scope: dict[str, Any], receive: Callable[..., Any], send: Callable[..., Any]) -> None:
    """Public health probe endpoint exempt from tenant identification."""
    body = b'{"status": "ok", "service": "klarity-api"}'
    await send({
        "type": "http.response.start",
        "status": 200,
        "headers": [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(body)).encode("ascii")),
        ],
    })
    await send({"type": "http.response.body", "body": body})


async def current_tenant_handler(scope: dict[str, Any], receive: Callable[..., Any], send: Callable[..., Any]) -> None:
    """Protected endpoint returning the active tenant context."""
    ctx = current_tenant()
    data = {
        "tenant_id": ctx.tenant_id,
        "tier": ctx.tier.value,
        "status": ctx.status.value,
        "placement": {
            "object_bucket": ctx.placement.object_bucket,
            "object_prefix": ctx.placement.object_prefix,
            "qdrant_shard_key": ctx.placement.qdrant_shard_key,
            "opensearch_index": ctx.placement.opensearch_index,
        },
    }
    body = json.dumps(data).encode("utf-8")
    await send({
        "type": "http.response.start",
        "status": 200,
        "headers": [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(body)).encode("ascii")),
        ],
    })
    await send({"type": "http.response.body", "body": body})


async def not_found_handler(scope: dict[str, Any], receive: Callable[..., Any], send: Callable[..., Any]) -> None:
    """Default 404 handler."""
    body = b'{"error": "not_found", "detail": "The requested resource does not exist"}'
    await send({
        "type": "http.response.start",
        "status": 404,
        "headers": [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(body)).encode("ascii")),
        ],
    })
    await send({"type": "http.response.body", "body": body})


class CoreApiRouter:
    """Basic ASGI router for core API endpoints."""

    def __init__(self) -> None:
        self.routes: dict[tuple[str, str], Callable[..., Any]] = {
            ("GET", "/healthz"): healthz_handler,
            ("GET", "/readyz"): healthz_handler,
            ("GET", "/api/v1/tenant/current"): current_tenant_handler,
        }

    async def __call__(self, scope: dict[str, Any], receive: Callable[..., Any], send: Callable[..., Any]) -> None:
        if scope["type"] != "http":
            return
        method = scope.get("method", "GET")
        path = scope.get("path", "/")
        handler = self.routes.get((method, path), not_found_handler)
        await handler(scope, receive, send)


def create_app(resolver: PlacementResolver) -> TenantMiddleware:
    """Factory creating the complete API application wrapped in TenantMiddleware."""
    router = CoreApiRouter()
    return TenantMiddleware(app=router, resolver=resolver)
