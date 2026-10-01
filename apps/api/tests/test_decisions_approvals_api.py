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


# ---- data endpoints: authentication, finance permission (rule 2), no fixture numbers outside development ----

def test_data_endpoints_require_a_signed_in_user(app) -> None:
    for method, path, body in (("GET", "/api/v1/finance/summary", None), ("GET", "/api/v1/finance/cash", None),
                               ("GET", "/api/v1/projects", None), ("POST", "/api/v1/ask", {"question": "Phoenix overrun?"})):
        assert call(app, method, path, body)[0] == 401, path


def test_finance_needs_finance_permission(app) -> None:
    # dev-member belongs to a project but is not a finance viewer
    assert call(app, "GET", "/api/v1/finance/summary", user="dev-member")[0] == 403
    status, res = call(app, "GET", "/api/v1/finance/summary", user="dev-admin")
    assert status == 200 and res["demo"] is True


def test_ask_denies_before_retrieval_without_finance_access(app) -> None:
    status, res = call(app, "POST", "/api/v1/ask", {"question": "Why is Project Phoenix over budget?", "projectId": "prj-phoenix"},
                       user="dev-member")
    assert status == 200 and res["status"] == "no_access" and res["facts"] == [] and res["evidence"] == []
    status, res = call(app, "POST", "/api/v1/ask", {"question": "Why is Project Phoenix over budget?", "projectId": "prj-phoenix"},
                       user="dev-admin")
    assert res["status"] == "answered" and res["facts"]


def test_projects_are_filtered_by_what_the_user_can_see(app) -> None:
    ids = lambda u: {p["project_id"] for p in call(app, "GET", "/api/v1/projects", user=u)[1]["projects"]}  # noqa: E731
    assert ids("dev-admin") == {"prj-phoenix", "prj-studio8"}
    assert ids("dev-member") == {"prj-phoenix"}
    assert ids("stranger") == set()


def test_production_without_a_data_source_never_serves_fixture_numbers(tmp_path: Any) -> None:
    from apps.api.composition.container import DEV_ADMIN, Services

    reg = FileTenantRegistry(tmp_path / "c.json")
    seed(reg, activate=True)
    svc = Services.in_memory(demo=False)
    app = create_app(PlacementResolver(reg, ttl_seconds=60), auth_mode="development", services=svc)
    from tenant_context import tenant_scope
    from storage import TupleKey
    ctx = PlacementResolver(reg, ttl_seconds=60).resolve(STUDIO8_ID)
    with tenant_scope(ctx):
        svc.fga.write_tuples([TupleKey(f"user:{DEV_ADMIN}", "admin", f"tenant:{STUDIO8_ID}")], [])
    assert call(app, "GET", "/api/v1/finance/summary", user=DEV_ADMIN)[0] == 501
    assert call(app, "GET", "/api/v1/projects", user=DEV_ADMIN)[0] == 501
    status, res = call(app, "POST", "/api/v1/ask", {"question": "Why is Project Phoenix over budget?"}, user=DEV_ADMIN)
    assert status == 200 and res["facts"] == [] and res["status"] == "insufficient_evidence"


# ---- the same API on the SQL stores: persistence across restarts, audit rows, tenant isolation in the database ----

def test_api_on_sql_stores_persists_across_restart_and_writes_audit_rows(tmp_path: Any) -> None:
    from apps.api.composition.container import Services
    from storage.testing import sqlite_engine
    from tenant_context import tenant_scope

    reg = FileTenantRegistry(tmp_path / "c.json")
    seed(reg, activate=True)
    resolver = PlacementResolver(reg, ttl_seconds=60)
    engine = sqlite_engine()

    first = create_app(resolver, auth_mode="development", services=Services.from_engine(engine, demo=True))
    assert call(first, "POST", "/api/v1/decisions", {"decision_id": "dec-002", "action": "confirm", "note": "ok"}, user="dev-admin")[0] == 200
    aid = call(first, "GET", "/api/v1/approvals?status=pending")[1]["approvals"][0]["approvalId"]
    assert call(first, "POST", f"/api/v1/approvals/{aid}/approve", {}, user="dev-admin")[0] == 200

    # "restart": a brand-new application and service container on the same database
    second = create_app(resolver, auth_mode="development", services=Services.from_engine(engine, demo=True))
    decisions = {d["decisionId"]: d for d in call(second, "GET", "/api/v1/decisions")[1]["decisions"]}
    assert decisions["dec-002"]["status"] == "decided" and decisions["dec-002"]["decidedBy"] == "dev-admin"
    approvals = call(second, "GET", "/api/v1/approvals")[1]["approvals"]
    assert [a["status"] for a in approvals] == ["approved"]  # not re-seeded, not reset

    ctx = resolver.resolve(STUDIO8_ID)
    with tenant_scope(ctx):
        rows = second.app.services.audit.by_tenant(STUDIO8_ID)
    actions = [r.action for r in rows]
    assert "decision.confirmed" in actions and "approval.approved" in actions and "approval.requested" in actions
    assert all(r.tenant_id == STUDIO8_ID for r in rows)
    with tenant_scope(resolver.resolve(SYNTHETIC_ID)):
        assert not any(r.entity_id == "dec-002" and r.action == "decision.confirmed"
                       for r in second.app.services.audit.by_tenant(SYNTHETIC_ID))
    synth = {d["decisionId"]: d["status"] for d in call(second, "GET", "/api/v1/decisions", tenant=SYNTHETIC_ID)[1]["decisions"]}
    assert synth["dec-002"] == "proposed"  # same id, other tenant, untouched
