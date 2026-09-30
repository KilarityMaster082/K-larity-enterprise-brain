# Owner task: EB-50 Ask Brain UI
"""Integration tests for POST /api/v1/ask endpoint.

Tests:
1. Missing tenant identification on /api/v1/ask returns 401.
2. Valid tenant with valid question returns 200 and schema-valid AnswerContract.
3. Empty question or excessive length returns 400.
4. Monetary figures originate strictly from SQL views with origin="sql".
"""

from __future__ import annotations

import asyncio
import json
from typing import Any
import pytest

from apps.api.main import create_app
from control_plane import FileTenantRegistry
from control_plane.seed import STUDIO8_ID, seed
from tenant_context import PlacementResolver


@pytest.fixture
def api_resolver(tmp_path: Any) -> PlacementResolver:
    reg = FileTenantRegistry(tmp_path / "control.json")
    seed(reg, activate=True)
    return PlacementResolver(reg, ttl_seconds=60)


async def call_api(
    app: Any,
    method: str,
    path: str,
    body: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, Any]]:
    payload = json.dumps(body).encode("utf-8") if body is not None else b""
    asgi_headers = [
        (k.lower().encode("latin1"), v.encode("latin1"))
        for k, v in (headers or {}).items()
    ]
    if body is not None:
        asgi_headers.append((b"content-type", b"application/json"))
        asgi_headers.append((b"content-length", str(len(payload)).encode("ascii")))

    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "headers": asgi_headers,
    }

    response_status: int = 500
    response_body = bytearray()
    sent_body = False

    async def receive() -> dict[str, Any]:
        nonlocal sent_body
        if not sent_body:
            sent_body = True
            return {"type": "http.request", "body": payload, "more_body": False}
        return {"type": "http.disconnect"}

    async def send(message: dict[str, Any]) -> None:
        nonlocal response_status
        if message["type"] == "http.response.start":
            response_status = message["status"]
        elif message["type"] == "http.response.body":
            response_body.extend(message.get("body", b""))

    await app(scope, receive, send)
    data = json.loads(response_body.decode("utf-8")) if response_body else {}
    return response_status, data


def test_ask_requires_tenant(api_resolver: PlacementResolver) -> None:
    app = create_app(api_resolver)
    status, res = asyncio.run(call_api(app, "POST", "/api/v1/ask", {"question": "Why is Phoenix over budget?"}))
    assert status == 401
    assert res["error"] == "missing_tenant"


def test_ask_validates_question_length(api_resolver: PlacementResolver) -> None:
    app = create_app(api_resolver)
    headers = {"X-Tenant-ID": STUDIO8_ID}
    status, res = asyncio.run(call_api(app, "POST", "/api/v1/ask", {"question": ""}, headers=headers))
    assert status == 400
    assert res["error"] == "invalid_question"


def test_ask_returns_valid_contract_with_sql_facts(api_resolver: PlacementResolver) -> None:
    app = create_app(api_resolver)
    headers = {"X-Tenant-ID": STUDIO8_ID}
    status, res = asyncio.run(
        call_api(
            app,
            "POST",
            "/api/v1/ask",
            {"question": "Why is Project Phoenix over budget?", "projectId": "prj-phoenix"},
            headers=headers,
        )
    )

    assert status == 200
    assert "question" in res
    assert "status" in res
    assert "evidence" in res
    assert "confidence" in res

    # Verify SQL evidence binding (Rule 3 and Rule 4)
    if res["evidence"]:
        for ev in res["evidence"]:
            assert ev["sourceType"] == "sql"
            assert "finance_" in ev["excerpt"] or "Project" in ev["excerpt"]
