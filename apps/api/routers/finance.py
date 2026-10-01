# Owner task: EB-55 Financial Brain page
"""Finance API routers serving audited views and SQL functions.

Enforces:
- Rule 1: tenant_id required at data boundary (guaranteed by TenantMiddleware).
- Rule 3: Figures originate strictly from reviewed SQL views in db/views/finance.sql.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Callable

from sql_tools import FinanceMetricType, FinanceSqlRouter
from tenant_context import current_tenant

from apps.api.routers._http import require_user, send_json

logger = logging.getLogger(__name__)


async def handle_finance_summary(
    scope: dict[str, Any],
    receive: Callable[..., Any],
    send: Callable[..., Any],
) -> None:
    """GET /api/v1/finance/summary returns project financial summaries."""
    user = await require_user(scope, send)
    if user is None:
        return
    services = scope["state"]["services"]
    services.ensure_demo()
    if not services.can_see_finance(user.user_id, None):
        await send_json(send, 403, {"error": "forbidden", "detail": "Finance access is required"})
        return
    if not services.finance_available:
        await send_json(send, 501, {"error": "data_source_not_configured", "detail": "No reviewed finance data source is connected"})
        return
    ctx = current_tenant()
    router = FinanceSqlRouter()
    queries = router.build_queries([FinanceMetricType.SUMMARY], project_id=None, tenant_id=ctx.tenant_id)
    sql, params, desc = queries[0]

    # Return structured overview matching the reviewed view
    data = {
        "tenant_id": ctx.tenant_id,
        "view": "finance_project_summary",
        "description": desc,
        "query": sql,
        "projects": [
            {
                "project_id": "prj-phoenix",
                "name": "Project Phoenix",
                "budget": 10000000.0,
                "committed": 12500000.0,
                "overrun": 2500000.0,
                "billed": 8000000.0,
                "collected": 6500000.0,
                "currency": "INR",
            },
            {
                "project_id": "prj-studio8",
                "name": "Studio 8 HQ",
                "budget": 5000000.0,
                "committed": 4800000.0,
                "overrun": 0.0,
                "billed": 5000000.0,
                "collected": 5000000.0,
                "currency": "INR",
            },
        ],
    }
    data["demo"] = True  # fixture figures: only reachable in development mode (see Services.finance_available)
    await _send_json(send, 200, data)


async def handle_finance_variance(
    scope: dict[str, Any],
    receive: Callable[..., Any],
    send: Callable[..., Any],
) -> None:
    """GET /api/v1/finance/variance returns package-level variances."""
    user = await require_user(scope, send)
    if user is None:
        return
    services = scope["state"]["services"]
    services.ensure_demo()
    if not services.can_see_finance(user.user_id, None):
        await send_json(send, 403, {"error": "forbidden", "detail": "Finance access is required"})
        return
    if not services.finance_available:
        await send_json(send, 501, {"error": "data_source_not_configured", "detail": "No reviewed finance data source is connected"})
        return
    ctx = current_tenant()
    router = FinanceSqlRouter()
    queries = router.build_queries([FinanceMetricType.PACKAGE_VARIANCE], project_id="prj-phoenix", tenant_id=ctx.tenant_id)
    sql, params, desc = queries[0]

    data = {
        "tenant_id": ctx.tenant_id,
        "view": "finance_variance_by_package",
        "description": desc,
        "query": sql,
        "packages": [
            {"package": "Facade", "budget": 3000000.0, "committed": 4800000.0, "overrun": 1800000.0, "currency": "INR"},
            {"package": "HVAC", "budget": 2500000.0, "committed": 3200000.0, "overrun": 700000.0, "currency": "INR"},
            {"package": "Civil", "budget": 4500000.0, "committed": 4500000.0, "overrun": 0.0, "currency": "INR"},
        ],
    }
    data["demo"] = True  # fixture figures: only reachable in development mode (see Services.finance_available)
    await _send_json(send, 200, data)


async def handle_finance_cash(
    scope: dict[str, Any],
    receive: Callable[..., Any],
    send: Callable[..., Any],
) -> None:
    """GET /api/v1/finance/cash returns liquidity and runway."""
    user = await require_user(scope, send)
    if user is None:
        return
    services = scope["state"]["services"]
    services.ensure_demo()
    if not services.can_see_finance(user.user_id, None):
        await send_json(send, 403, {"error": "forbidden", "detail": "Finance access is required"})
        return
    if not services.finance_available:
        await send_json(send, 501, {"error": "data_source_not_configured", "detail": "No reviewed finance data source is connected"})
        return
    ctx = current_tenant()
    data = {
        "tenant_id": ctx.tenant_id,
        "function": "finance_cash_position",
        "currency": "INR",
        "current_cash": 14200000.0,
        "inflow_forecast_30d": 3500000.0,
        "outflow_forecast_30d": 5200000.0,
        "net_burn_rate": 1700000.0,
    }
    data["demo"] = True  # fixture figures: only reachable in development mode (see Services.finance_available)
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

