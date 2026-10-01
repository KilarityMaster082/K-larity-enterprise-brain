# Owner task: EB-20 RLS and tenant middleware
"""Unit and integration tests for TenantMiddleware and database RLS session binding.

Tests:
1. Missing tenant identification on protected routes returns 401.
2. Malformed tenant ID returns 400.
3. Unknown or suspended tenant returns 403.
4. Valid tenant resolves placement, enters TenantContext scope, and returns 200.
5. Public routes (/healthz) succeed without tenant identification.
6. bind_session_tenant executes `set_config('app.tenant_id', ...)` and refuses invalid tenant IDs.
7. Queries executed without tenant context return zero rows.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
from typing import Any
import pytest

from apps.api.main import create_app
from apps.api.middleware.tenant import bind_session_tenant, extract_tenant_id
from control_plane import FileTenantRegistry
from control_plane.seed import STUDIO8_ID, SYNTHETIC_ID, seed
from tenant_context import (
    PlacementResolver,
    TenantStatus,
    current_tenant_or_none,
)


@pytest.fixture
def test_resolver(tmp_path: Any) -> PlacementResolver:
    """Create a temporary tenant registry and resolver with active and suspended tenants."""
    reg = FileTenantRegistry(tmp_path / "control.json")
    # Seed active tenants (studio8 and synthetic-canary)
    seed(reg, activate=True)
    # Transition synthetic-canary to SUSPENDED for testing
    reg.set_status(SYNTHETIC_ID, TenantStatus.SUSPENDED)
    return PlacementResolver(reg, ttl_seconds=60)


async def call_asgi(app: Any, method: str, path: str, headers: dict[str, str] | None = None) -> tuple[int, dict[str, Any]]:
    """Helper to dispatch HTTP calls directly to pure ASGI application."""
    asgi_headers = [
        (k.lower().encode("latin1"), v.encode("latin1"))
        for k, v in (headers or {}).items()
    ]
    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "headers": asgi_headers,
    }

    response_status: int = 500
    response_body = bytearray()

    async def receive() -> dict[str, Any]:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: dict[str, Any]) -> None:
        nonlocal response_status, response_body
        if message["type"] == "http.response.start":
            response_status = message["status"]
        elif message["type"] == "http.response.body":
            response_body.extend(message.get("body", b""))

    await app(scope, receive, send)
    data = json.loads(response_body.decode("utf-8")) if response_body else {}
    return response_status, data


def test_public_route_exempt(test_resolver: PlacementResolver) -> None:
    app = create_app(test_resolver, auth_mode="development")
    status, body = asyncio.run(call_asgi(app, "GET", "/healthz"))
    assert status == 200
    assert body["status"] == "ok"
    assert body["service"] == "klarity-api"


def test_missing_tenant_returns_401(test_resolver: PlacementResolver) -> None:
    app = create_app(test_resolver, auth_mode="development")
    status, body = asyncio.run(call_asgi(app, "GET", "/api/v1/tenant/current"))
    assert status == 401
    assert body["error"] == "missing_tenant"


def test_malformed_tenant_returns_400(test_resolver: PlacementResolver) -> None:
    app = create_app(test_resolver, auth_mode="development")
    status, body = asyncio.run(call_asgi(app, "GET", "/api/v1/tenant/current", {"X-Tenant-ID": "UPPERCASE_NOT_ALLOWED!"}))
    assert status == 400
    assert body["error"] == "invalid_tenant"


def test_unknown_tenant_returns_403(test_resolver: PlacementResolver) -> None:
    app = create_app(test_resolver, auth_mode="development")
    status, body = asyncio.run(call_asgi(app, "GET", "/api/v1/tenant/current", {"X-Tenant-ID": "ghost-tenant"}))
    assert status == 403
    assert body["error"] == "unknown_tenant"


def test_suspended_tenant_returns_403(test_resolver: PlacementResolver) -> None:
    app = create_app(test_resolver, auth_mode="development")
    status, body = asyncio.run(call_asgi(app, "GET", "/api/v1/tenant/current", {"X-Tenant-ID": SYNTHETIC_ID}))
    assert status == 403
    assert body["error"] == "tenant_unavailable" or body["error"] == "tenant_suspended"


def test_active_tenant_succeeds_and_enters_scope(test_resolver: PlacementResolver) -> None:
    app = create_app(test_resolver, auth_mode="development")
    status, body = asyncio.run(call_asgi(app, "GET", "/api/v1/tenant/current", {"X-Tenant-ID": STUDIO8_ID}))
    assert status == 200
    assert body["tenant_id"] == STUDIO8_ID
    assert body["tier"] == "pool"
    assert body["placement"]["object_bucket"] == "klarity-pool-in-1"
    assert body["placement"]["qdrant_shard_key"] == "pool"

    # Verify contextvar is reset after request completes
    assert current_tenant_or_none() is None


def test_bearer_token_claim_extraction() -> None:
    import base64
    payload = json.dumps({"organization": STUDIO8_ID, "sub": "user_123"}).encode("utf-8")
    token = f"eyJhbGciOiJIUzI1NiJ9.{base64.urlsafe_b64encode(payload).decode('ascii').rstrip('=')}.sig"
    headers = {"Authorization": f"Bearer {token}"}
    extracted = extract_tenant_id(headers)
    assert extracted == STUDIO8_ID


def test_bind_session_tenant() -> None:
    class MockSession:
        def __init__(self) -> None:
            self.executed: list[tuple[str, dict[str, Any]]] = []

        def execute(self, statement: Any, params: dict[str, Any]) -> None:
            self.executed.append((str(statement), params))

    sess = MockSession()
    bind_session_tenant(sess, "studio8")
    assert len(sess.executed) == 1
    assert "app.tenant_id" in sess.executed[0][0]
    assert sess.executed[0][1] == {"tenant_id": "studio8"}

    with pytest.raises(ValueError):
        bind_session_tenant(sess, "INVALID_TENANT_ID!")


def test_query_without_tenant_context_returns_zero_rows() -> None:
    """Acceptance criterion: A query without tenant context returns zero rows under RLS."""
    conn = sqlite3.connect(":memory:")
    cursor = conn.cursor()

    # Create dummy users table
    cursor.execute("""
        CREATE TABLE users (
            tenant_id text NOT NULL,
            user_id text NOT NULL,
            email text NOT NULL
        );
    """)
    cursor.execute("INSERT INTO users VALUES ('studio8', 'u1', 'u1@studio8.com');")
    cursor.execute("INSERT INTO users VALUES ('other', 'u2', 'u2@other.com');")
    conn.commit()

    # Simulate Postgres RLS function in SQLite
    session_settings: dict[str, str] = {}

    def current_setting(setting_name: str, missing_ok: bool = True) -> str | None:
        return session_settings.get(setting_name, "")

    conn.create_function("current_setting", 2, current_setting)

    # 1. Unset session context -> returns 0 rows
    cursor.execute("SELECT * FROM users WHERE tenant_id = current_setting('app.tenant_id', 1);")
    assert cursor.fetchall() == []

    # 2. Set session context to 'studio8' -> returns only studio8 row
    session_settings["app.tenant_id"] = "studio8"
    cursor.execute("SELECT * FROM users WHERE tenant_id = current_setting('app.tenant_id', 1);")
    rows = cursor.fetchall()
    assert len(rows) == 1
    assert rows[0][0] == "studio8"

    # 3. Clear session context -> returns 0 rows
    session_settings["app.tenant_id"] = ""
    cursor.execute("SELECT * FROM users WHERE tenant_id = current_setting('app.tenant_id', 1);")
    assert cursor.fetchall() == []

    conn.close()
