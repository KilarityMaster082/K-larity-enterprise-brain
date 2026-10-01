# Owner task: EB-53 · EB-66 · EB-24 (PostgreSQL: row-level security, constraints, append-only audit)
"""Runs against a real migrated PostgreSQL, as the NOBYPASSRLS application role. Skipped unless both are set:

    KLARITY_TEST_APP_URL    postgresql://klarity_app:...@host/brain      (the API's role)
    KLARITY_TEST_ADMIN_URL  postgresql://klarity_admin:...@host/brain    (schema owner; to prove triggers hold for owners)

The database must already be migrated (deploy/postgres/migrate.sh, or `make dev-up`). Every test uses fresh tenant ids
and cleans nothing up that it does not own, so it is safe to re-run. Needs a driver (psycopg2 or psycopg)."""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

import pytest

APP_URL, ADMIN_URL = os.environ.get("KLARITY_TEST_APP_URL"), os.environ.get("KLARITY_TEST_ADMIN_URL")
pytestmark = pytest.mark.skipif(not (APP_URL and ADMIN_URL), reason="set KLARITY_TEST_APP_URL and KLARITY_TEST_ADMIN_URL")

from sqlalchemy import create_engine, text  # noqa: E402  (after the skip so a missing driver cannot break collection)

from packages.approvals import ApprovalKind, ApprovalService, ApprovalStatus, RequestedVia  # noqa: E402
from packages.approvals.sql_store import SqlApprovalStore  # noqa: E402
from storage import SqlRecordStore, bind_session_tenant  # noqa: E402
from tenant_context import CrossTenantAccessError, Placement, TenantContext, TenantStatus, Tier, tenant_scope  # noqa: E402


def _ctx(tid: str) -> TenantContext:
    p = Placement(cell_id="c", region="r", pg_cluster="p", pg_database="d", object_bucket="b", object_prefix=f"tenants/{tid}/",
                  qdrant_cluster="q", qdrant_shard_key="s", opensearch_cluster="o", opensearch_index="i", opensearch_alias="a",
                  fga_store="f", temporal_namespace="n", temporal_queue_prefix="q", litellm_team="t", kms_key_ref="k")
    return TenantContext(tid, tid, TenantStatus.ACTIVE, Tier.POOL, p)


@pytest.fixture(scope="module")
def app_engine():
    return create_engine(APP_URL, pool_pre_ping=True)  # the app role; tests need raw access, create_app_engine is covered elsewhere


@pytest.fixture(scope="module")
def admin_engine():
    return create_engine(ADMIN_URL, pool_pre_ping=True)


@pytest.fixture
def tenants():
    suffix = uuid.uuid4().hex[:8]
    return f"pg-a-{suffix}", f"pg-b-{suffix}"


def _new(svc, who="agent:pm"):
    return svc.request(kind=ApprovalKind.DRAFT_MESSAGE, title="t", body="b", requested_by=who, requested_via=RequestedVia.AGENT,
                       reason="why", evidence_ids=("ev_1",), project_id=None)


def test_rls_alone_isolates_tenants_even_without_the_explicit_filter(app_engine, tenants) -> None:
    a, b = tenants
    for t in (a, b):
        svc = ApprovalService(SqlApprovalStore(app_engine), can_decide=lambda u, r: True)
        with tenant_scope(_ctx(t)):
            _new(svc)
    with app_engine.begin() as conn:  # no tenant bound: the policy compares against NULL → no rows
        assert conn.execute(text("SELECT count(*) FROM approvals WHERE tenant_id IN (:a, :b)"), {"a": a, "b": b}).scalar() == 0
    with app_engine.begin() as conn:
        bind_session_tenant(conn, a)  # bound to A, and the query even *asks* for B's rows: RLS still hides them
        rows = conn.execute(text("SELECT tenant_id FROM approvals WHERE tenant_id IN (:a, :b)"), {"a": a, "b": b}).all()
        assert {r[0] for r in rows} == {a}


def test_rls_with_check_blocks_writing_another_tenants_row(app_engine, tenants) -> None:
    a, b = tenants
    with app_engine.connect() as conn:
        trans = conn.begin()
        bind_session_tenant(conn, a)
        with pytest.raises(Exception, match="(?i)row-level security"):
            conn.execute(text("INSERT INTO approvals (tenant_id, approval_id, kind, title, body, requested_by, requested_via, requested_at,"
                              " reason, evidence_ids) VALUES (:t, 'apr_x', 'create_task', 't', 'b', 'u', 'person', now(), 'r', '[\"e\"]')"),
                         {"t": b})
        trans.rollback()


def test_approval_service_on_postgres_end_to_end(app_engine, tenants) -> None:
    a, b = tenants
    svc = ApprovalService(SqlApprovalStore(app_engine), can_decide=lambda u, r: u == "asha")
    with tenant_scope(_ctx(a)):
        req = _new(svc)
        assert svc.approve(req.approval_id, "asha").status is ApprovalStatus.APPROVED
        stale = svc.get(req.approval_id)
        svc.consume(req.approval_id, "agent:pm")
        assert SqlApprovalStore(app_engine).compare_and_set(stale, stale.with_(status=ApprovalStatus.EXECUTED, executed_at=datetime.now(timezone.utc))) is False
        assert svc.get(req.approval_id).status is ApprovalStatus.EXECUTED
    with tenant_scope(_ctx(b)):
        assert svc.list() == []


def test_database_enforces_separation_of_duties_and_executed_after_approval(app_engine, tenants) -> None:
    a, _ = tenants
    store = SqlApprovalStore(app_engine)
    svc = ApprovalService(store, can_decide=lambda u, r: True)
    with tenant_scope(_ctx(a)):
        req = _new(svc, who="priya")
        with pytest.raises(Exception, match="(?i)approvals_no_self_decision"):
            store.compare_and_set(req, req.with_(status=ApprovalStatus.APPROVED, decided_by="priya"))
        with pytest.raises(Exception, match="(?i)approvals_executed_only_after_approval"):
            store.compare_and_set(req, req.with_(status=ApprovalStatus.EXECUTED))


def test_audit_log_is_append_only_for_the_app_role_and_for_the_owner(app_engine, admin_engine, tenants) -> None:
    from apps.api.audit import AuditEvent, SqlAuditWriter  # noqa: PLC0415

    a, b = tenants
    writer = SqlAuditWriter(app_engine)
    with tenant_scope(_ctx(a)):
        writer.write(AuditEvent(tenant_id=a, action="decision.confirmed", entity_type="decision", entity_id="d1", user_id="asha",
                                details={"note": "ok"}))
        rows = writer.by_tenant(a)
        assert rows[0].details == {"note": "ok"} and rows[0].user_id == "asha"
        with pytest.raises(CrossTenantAccessError):
            writer.write(AuditEvent(tenant_id=b, action="x.y", entity_type="x", entity_id="1"))
    with tenant_scope(_ctx(b)):
        assert writer.by_tenant(b) == []
    # Bind the tenant for both roles: FORCE RLS applies to the owner too, so an unbound UPDATE would touch zero rows and
    # prove nothing. With the rows visible, only the grants (app role) or the trigger (owner) can stop the change.
    for engine in (app_engine, admin_engine):
        for stmt in ("UPDATE audit_log SET action = 'tampered' WHERE tenant_id = :t", "DELETE FROM audit_log WHERE tenant_id = :t"):
            with pytest.raises(Exception, match="(?i)append-only|permission denied"):
                with engine.begin() as conn:
                    bind_session_tenant(conn, a)
                    conn.execute(text(stmt), {"t": a})
    with admin_engine.begin() as conn:
        bind_session_tenant(conn, a)
        assert conn.execute(text("SELECT action FROM audit_log WHERE tenant_id = :t"), {"t": a}).scalar() == "decision.confirmed"
    with pytest.raises(Exception, match="(?i)append-only|permission denied"):
        with admin_engine.begin() as conn:
            conn.execute(text("TRUNCATE audit_log"))


def test_app_role_cannot_read_the_migration_ledger_or_bypass_rls(app_engine) -> None:
    with pytest.raises(Exception, match="(?i)permission denied"):
        with app_engine.begin() as conn:
            conn.execute(text("SELECT * FROM schema_migrations"))
    with app_engine.begin() as conn:
        assert conn.execute(text("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")).one() == (False, False)


def test_decision_memory_on_postgres_roundtrips_every_type_and_isolates_tenants(app_engine, tenants) -> None:
    """jsonb, numeric, timestamptz, integer and compare-and-set on the real column types."""
    from decision_memory import DecisionMemory, DecisionStatus, InvalidChange, NotFound  # noqa: PLC0415
    from decision_sql_store import SqlDecisionStore  # noqa: PLC0415

    a, b = tenants
    when = datetime(2026, 10, 1, 12, 30, tzinfo=timezone.utc)
    mem = DecisionMemory(can_review=lambda u, d: True, store=SqlDecisionStore(app_engine), clock=lambda: when)
    with tenant_scope(_ctx(a)):
        mem.propose(decision_id="dec-9", project_id=None, title="Use M40", description="d", evidence_ids=("ev_1", "ev_2"),
                    confidence=0.7, source_ref="gmail:1")
        mem.edit("dec-9", "priya", alternatives=["M35", "M45"], cost_impact="1800000.50", time_impact_days=3, rationale="IS 456")
        stale = mem.get("dec-9")
        mem.confirm("dec-9", "priya", "agreed")
        d = mem.get("dec-9")
        assert mem.store.compare_and_set(stale, stale.__class__(**{**stale.__dict__, "title": "tampered", "version": 3})) is False
        with pytest.raises(InvalidChange):
            mem.confirm("dec-9", "priya")
    assert d.evidence_ids == ("ev_1", "ev_2") and d.alternatives == ("M35", "M45") and abs(d.confidence - 0.7) < 1e-9
    assert d.decided_at == when and d.time_impact_days == 3 and d.status is DecisionStatus.DECIDED and d.version == 3
    assert float(d.cost_impact) == 1800000.5
    with tenant_scope(_ctx(b)):
        assert mem.list() == []
        with pytest.raises(NotFound):
            mem.get("dec-9")
