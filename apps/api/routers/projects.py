# Owner task: EB-54 Project Brain page
"""Project Brain API router serving active projects and metadata.

Enforces:
- Rule 1: tenant_id required at data boundary (guaranteed by TenantMiddleware).
"""

from __future__ import annotations

import json
import logging
from typing import Any, Callable

from tenant_context import current_tenant

logger = logging.getLogger(__name__)

_SEED_PROJECTS = [
    {
        "project_id": "prj-phoenix",
        "name": "Project Phoenix",
        "code": "PHX-2026",
        "status": "active",
        "lead": "Priya Sharma",
        "city": "Hyderabad",
        "budget": 10000000.0,
        "committed": 12500000.0,
        "overrun": 2500000.0,
        "completion_pct": 68,
    },
    {
        "project_id": "prj-studio8",
        "name": "Studio 8 HQ",
        "code": "S8-HQ",
        "status": "active",
        "lead": "Vikram Seth",
        "city": "Bengaluru",
        "budget": 5000000.0,
        "committed": 4800000.0,
        "overrun": 0.0,
        "completion_pct": 92,
    },
]


async def handle_projects(
    scope: dict[str, Any],
    receive: Callable[..., Any],
    send: Callable[..., Any],
) -> None:
    """GET /api/v1/projects returns tenant projects."""
    ctx = current_tenant()
    data = {
        "tenant_id": ctx.tenant_id,
        "projects": _SEED_PROJECTS,
    }
    await _send_json(send, 200, data)


async def _send_json(send: Callable[..., Any], status: int, data: dict[str, Any]) -> None:
    body = json.dumps(data).encode("utf-8")
    await send({
        "type": "http.response.start",
        "status": status,
        "headers": [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(body)).encode("ascii")),
        ],
    })
    await send({"type": "http.response.body", "body": body})

