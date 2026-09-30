# Owner task: EB-20 RLS and tenant middleware
"""Integration tests for Finance, Decisions, and Projects core API endpoints."""

from __future__ import annotations

import asyncio
from typing import Any
import pytest

from apps.api.main import create_app
from apps.api.tests.test_ask_api import call_api
from control_plane import FileTenantRegistry
from control_plane.seed import STUDIO8_ID, seed
from tenant_context import PlacementResolver


@pytest.fixture
def core_resolver(tmp_path: Any) -> PlacementResolver:
    reg = FileTenantRegistry(tmp_path / "control.json")
    seed(reg, activate=True)
    return PlacementResolver(reg, ttl_seconds=60)


def test_finance_summary_endpoint(core_resolver: PlacementResolver) -> None:
    app = create_app(core_resolver)
    headers = {"X-Tenant-ID": STUDIO8_ID}
    status, res = asyncio.run(call_api(app, "GET", "/api/v1/finance/summary", headers=headers))
    assert status == 200
    assert res["view"] == "finance_project_summary"
    assert len(res["projects"]) >= 2
    assert res["projects"][0]["project_id"] == "prj-phoenix"


def test_finance_variance_endpoint(core_resolver: PlacementResolver) -> None:
    app = create_app(core_resolver)
    headers = {"X-Tenant-ID": STUDIO8_ID}
    status, res = asyncio.run(call_api(app, "GET", "/api/v1/finance/variance", headers=headers))
    assert status == 200
    assert res["view"] == "finance_variance_by_package"
    assert any(pkg["package"] == "Facade" for pkg in res["packages"])


def test_finance_cash_endpoint(core_resolver: PlacementResolver) -> None:
    app = create_app(core_resolver)
    headers = {"X-Tenant-ID": STUDIO8_ID}
    status, res = asyncio.run(call_api(app, "GET", "/api/v1/finance/cash", headers=headers))
    assert status == 200
    assert res["function"] == "finance_cash_position"
    assert res["current_cash"] > 0


def test_decisions_list_and_triage(core_resolver: PlacementResolver) -> None:
    app = create_app(core_resolver)
    headers = {"X-Tenant-ID": STUDIO8_ID}

    # 1. List decisions
    status, res = asyncio.run(call_api(app, "GET", "/api/v1/decisions", headers=headers))
    assert status == 200
    assert len(res["decisions"]) >= 3

    # 2. Triage a decision (confirm)
    status, triage_res = asyncio.run(
        call_api(
            app,
            "POST",
            "/api/v1/decisions",
            {"decision_id": "dec-002", "action": "confirm"},
            headers=headers,
        )
    )
    assert status == 200
    assert triage_res["status"] == "decided"
    assert triage_res["audited"] is True


def test_projects_endpoint(core_resolver: PlacementResolver) -> None:
    app = create_app(core_resolver)
    headers = {"X-Tenant-ID": STUDIO8_ID}
    status, res = asyncio.run(call_api(app, "GET", "/api/v1/projects", headers=headers))
    assert status == 200
    assert any(p["project_id"] == "prj-phoenix" for p in res["projects"])
