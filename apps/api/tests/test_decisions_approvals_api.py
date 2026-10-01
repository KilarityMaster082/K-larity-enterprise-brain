# Owner task: EB-53 Decision Memory · EB-66 Approval model (API)
"""Decisions and approvals over HTTP: the reviewer is the authenticated user, authorised by OpenFGA, audited."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from apps.api.main import create_app
from apps.api.tests.test_ask_api import call_api
from control_plane import FileTenantRegistry
from control_plane.seed import STUDIO8_ID, SYNTHETIC_ID, seed
from tenant_context import PlacementResolver


@pytest.fixture
def app(tmp_path: Any):
    reg = FileTenantRegistry(tmp_path / "control.json")
    seed(reg, activate=True)
    return create_app(PlacementResolver(reg, ttl_seconds=60), auth_mode="development")


def H(user: str | None = None, tenant: str = STUDIO8_ID) -> dict[str, str]:
    return {"X-Tenant-ID": tenant, **({"X-User-ID": user} if user else {})}


def call(app, method, path, body=None, **kw):
    return asyncio.run(call_api(app, method, path, body, headers=H(**kw)))


def test_confirm_requires_a_signed_in_user(app) -> None:
    status, res = call(app, "POST", "/api/v1/decisions", {"decision_id": "dec-002", "action": "confirm"})
    assert status == 401 and res["error"] == "authentication_required"
    _, listing = call(app, "GET", "/api/v1/decisions?status=proposed")
    assert "dec-002" in {d["decisionId"] for d in listing["decisions"]}  # nothing changed


def test_unauthorised_user_cannot_confirm_but_reviewer_can(app) -> None:
    status, res = call(app, "POST", "/api/v1/decisions", {"decision_id": "dec-002", "action": "confirm"}, user="dev-member")
    assert status == 403 and res["error"] == "forbidden"
    status, res = call(app, "POST", "/api/v1/decisions", {"decision_id": "dec-002", "action": "confirm", "note": "ok"}, user="dev-admin")
    assert status == 200 and res["status"] == "decided" and res["decision"]["decidedBy"] == "dev-admin" and res["audited"] is True


def test_body_cannot_name_the_reviewer(app) -> None:
    status, res = call(app, "POST", "/api/v1/decisions",
                       {"decision_id": "dec-002", "action": "confirm", "reviewer": "dev-admin", "user_id": "dev-admin"}, user="dev-member")
    assert status == 403


def test_edit_reject_conflict_and_validation(app) -> None:
    status, res = call(app, "POST", "/api/v1/decisions", {"decision_id": "dec-002", "action": "edit",
                                                          "fields": {"rationale": "lead time", "cost_impact": "700000"}}, user="dev-admin")
    assert status == 200 and res["decision"]["rationale"] == "lead time"
    status, res = call(app, "POST", "/api/v1/decisions", {"decision_id": "dec-002", "action": "edit", "fields": {"decided_by": "x"}}, user="dev-admin")
    assert status == 409
    assert call(app, "POST", "/api/v1/decisions", {"decision_id": "dec-002", "action": "edit"}, user="dev-admin")[0] == 400
    assert call(app, "POST", "/api/v1/decisions", {"decision_id": "dec-002", "action": "reject"}, user="dev-admin")[0] == 200
    assert call(app, "POST", "/api/v1/decisions", {"decision_id": "dec-002", "action": "confirm"}, user="dev-admin")[0] == 409
    assert call(app, "POST", "/api/v1/decisions", {"decision_id": "nope", "action": "confirm"}, user="dev-admin")[0] == 404
    assert call(app, "POST", "/api/v1/decisions", {"decision_id": "dec-002", "action": "delete"}, user="dev-admin")[0] == 400
    assert call(app, "GET", "/api/v1/decisions?status=bogus")[0] == 400


def test_decisions_are_tenant_scoped_and_audited(app) -> None:
    call(app, "POST", "/api/v1/decisions", {"decision_id": "dec-002", "action": "confirm"}, user="dev-admin")
    status, res = call(app, "GET", "/api/v1/decisions", tenant=SYNTHETIC_ID)
    assert status == 200 and res["tenant_id"] == SYNTHETIC_ID
    studio = {d["decisionId"]: d["status"] for d in call(app, "GET", "/api/v1/decisions")[1]["decisions"]}
    assert studio["dec-002"] == "decided"
    # the same id in another tenant is a different record, untouched by the confirmation above
    other = {d["decisionId"]: d["status"] for d in res["decisions"]}
    assert other["dec-002"] == "proposed"
    events = app.app.services.audit.by_tenant(STUDIO8_ID)
    assert any(e.action == "decision.confirmed" and e.user_id == "dev-admin" for e in events)
    assert not any(e.action == "decision.confirmed" and e.entity_id == "dec-002" for e in app.app.services.audit.by_tenant(SYNTHETIC_ID))


def test_approvals_list_decide_and_guards(app) -> None:
    status, res = call(app, "GET", "/api/v1/approvals?status=pending")
    (pending,) = res["approvals"]
    aid = pending["approvalId"]
    assert pending["requestedVia"] == "agent" and pending["status"] == "pending"
    assert call(app, "POST", f"/api/v1/approvals/{aid}/approve", {})[0] == 401
    assert call(app, "POST", f"/api/v1/approvals/{aid}/approve", {}, user="mallory")[0] == 403
    # a plain project member may not approve (editor needed); a tenant admin may
    assert call(app, "POST", f"/api/v1/approvals/{aid}/approve", {}, user="dev-member")[0] == 403
    status, res = call(app, "POST", f"/api/v1/approvals/{aid}/approve", {"note": "go"}, user="dev-admin")
    assert status == 200 and res["approval"]["status"] == "approved" and res["approval"]["decidedBy"] == "dev-admin"
    assert call(app, "POST", f"/api/v1/approvals/{aid}/reject", {}, user="dev-admin")[0] == 409  # already decided
    assert call(app, "POST", "/api/v1/approvals/apr_nope/approve", {}, user="dev-admin")[0] == 404
    assert call(app, "POST", f"/api/v1/approvals/{aid}/execute", {}, user="dev-admin")[0] == 404  # no HTTP execute endpoint
    assert call(app, "GET", "/api/v1/approvals", tenant=SYNTHETIC_ID)[1]["approvals"][0]["status"] == "pending"


def test_production_container_starts_empty_without_demo_data(tmp_path: Any) -> None:
    from apps.api.composition.container import Services

    reg = FileTenantRegistry(tmp_path / "c.json")
    seed(reg, activate=True)
    app = create_app(PlacementResolver(reg, ttl_seconds=60), auth_mode="development", services=Services.in_memory(demo=False))
    assert call(app, "GET", "/api/v1/decisions")[1]["decisions"] == []
    assert call(app, "GET", "/api/v1/approvals")[1]["approvals"] == []
