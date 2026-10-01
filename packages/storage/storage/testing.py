# Owner task: EB-53 · EB-66 · EB-24 (test support for the SQL stores)
"""In-memory SQLite engine with a schema that mirrors db/migrations/0001 + 0006 closely enough to exercise the SQL
stores without a PostgreSQL server: same columns, the same CHECK constraints that matter (separation of duties,
executed-only-after-approval, decided fields), and the audit_log append-only triggers.

Row-level security cannot be reproduced in SQLite, so the stores' explicit ``tenant_id = :tenant_id`` filter is what
these tests prove; the RLS half is covered by the PostgreSQL tests (KLARITY_TEST_PG_URL)."""

from __future__ import annotations

from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

SQLITE_SCHEMA = [
    """CREATE TABLE decisions (
        tenant_id TEXT NOT NULL, decision_id TEXT NOT NULL, project_id TEXT, title TEXT NOT NULL,
        description TEXT NOT NULL, rationale TEXT, status TEXT NOT NULL DEFAULT 'decided'
          CHECK (status IN ('proposed','decided','superseded','revoked')),
        decided_by TEXT, decided_at TEXT, superseded_by TEXT, source_ref TEXT,
        alternatives TEXT NOT NULL DEFAULT '[]', evidence_ids TEXT NOT NULL DEFAULT '[]', cost_impact NUMERIC,
        time_impact_days INTEGER, confidence NUMERIC, reviewed_by TEXT, review_note TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (tenant_id, decision_id),
        CHECK (status <> 'decided' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)))""",
    """CREATE TABLE approvals (
        tenant_id TEXT NOT NULL, approval_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('draft_message','create_task','update_record')),
        title TEXT NOT NULL, body TEXT NOT NULL, project_id TEXT, requested_by TEXT NOT NULL,
        requested_via TEXT NOT NULL CHECK (requested_via IN ('ask_brain','agent','person')),
        requested_at TEXT NOT NULL, reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
        evidence_ids TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','approved','rejected','expired','cancelled','executed')),
        expires_at TEXT, decided_by TEXT, decided_at TEXT, note TEXT, executed_at TEXT, rev INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (tenant_id, approval_id),
        CHECK (status NOT IN ('approved','rejected') OR decided_by IS NOT requested_by),
        CHECK (status <> 'executed' OR (executed_at IS NOT NULL AND decided_by IS NOT NULL)))""",
    """CREATE TABLE audit_log (
        audit_id TEXT NOT NULL, tenant_id TEXT NOT NULL, user_id TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}', ip_address TEXT, user_agent TEXT,
        created_at TEXT NOT NULL, PRIMARY KEY (tenant_id, audit_id))""",
    """CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
       BEGIN SELECT RAISE(ABORT, 'audit_log is append-only (UPDATE denied)'); END""",
    """CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
       BEGIN SELECT RAISE(ABORT, 'audit_log is append-only (DELETE denied)'); END""",
]


def sqlite_engine():
    """Fresh in-memory SQLite engine with the decisions / approvals / audit_log tables."""
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    with engine.begin() as conn:
        for ddl in SQLITE_SCHEMA:
            conn.execute(text(ddl))
    return engine
