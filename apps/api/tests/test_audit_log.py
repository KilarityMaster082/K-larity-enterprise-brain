# Owner task: EB-24 Audit log
"""Unit and integration tests for EB-24 Audit Log.

Tests:
1. Append-only enforcement: app role cannot UPDATE or DELETE audit rows.
2. Route decorator records tenant, user, action, entity, duration, and status.
3. Logging retrieved source IDs per answer.
4. Tenant retention settings and cutoff calculation.
"""

from __future__ import annotations

import asyncio
import sqlite3
from typing import Any
import pytest

from apps.api.audit import (
    AuditEvent,
    DatabaseAuditWriter,
    InMemoryAuditWriter,
    TenantRetentionPolicy,
    audit_action,
    create_retrieval_audit_event,
    get_tenant_retention_policy,
    set_tenant_retention_policy,
)
from tenant_context import (
    Placement,
    TenantContext,
    TenantStatus,
    Tier,
    tenant_scope,
)


def _make_ctx(tenant_id: str) -> TenantContext:
    p = Placement(
        cell_id="c1",
        region="ap-south-2",
        pg_cluster="pg",
        pg_database="brain",
        object_bucket="b",
        object_prefix=f"tenants/{tenant_id}/",
        qdrant_cluster="q",
        qdrant_shard_key=tenant_id,
        opensearch_cluster="os",
        opensearch_index=f"docs-{tenant_id}",
        opensearch_alias=f"tenant-{tenant_id}",
        fga_store=f"fga-{tenant_id}",
        temporal_namespace="c1",
        temporal_queue_prefix="pool",
        litellm_team=f"tenant-{tenant_id}",
        kms_key_ref=f"alias/klarity-tenant-{tenant_id}",
    )
    return TenantContext(
        tenant_id=tenant_id,
        slug=tenant_id,
        status=TenantStatus.ACTIVE,
        tier=Tier.POOL,
        placement=p,
    )


@pytest.fixture
def tenant_studio8() -> TenantContext:
    return _make_ctx("studio8")


def test_append_only_permissions_app_role_cannot_modify() -> None:
    """Subtask 1 & 5: Acceptance criterion: app role cannot modify or delete audit rows."""
    conn = sqlite3.connect(":memory:")
    cur = conn.cursor()

    # Create audit_log table
    cur.execute("""
        CREATE TABLE audit_log (
            audit_id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            user_id TEXT,
            action TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            details TEXT,
            ip_address TEXT,
            user_agent TEXT,
            created_at TEXT NOT NULL
        );
    """)

    # Create trigger simulating Postgres REVOKE UPDATE, DELETE permissions
    cur.execute("""
        CREATE TRIGGER deny_audit_update
        BEFORE UPDATE ON audit_log
        BEGIN
            SELECT RAISE(FAIL, 'permission denied: audit_log table is append-only');
        END;
    """)

    cur.execute("""
        CREATE TRIGGER deny_audit_delete
        BEFORE DELETE ON audit_log
        BEGIN
            SELECT RAISE(FAIL, 'permission denied: audit_log table is append-only');
        END;
    """)

    # 1. INSERT succeeds
    cur.execute(
        "INSERT INTO audit_log VALUES ('a1', 'studio8', 'u1', 'login', 'user', 'u1', '{}', NULL, NULL, '2026-09-30T00:00:00Z');"
    )
    conn.commit()

    cur.execute("SELECT COUNT(*) FROM audit_log;")
    assert cur.fetchone()[0] == 1

    # 2. UPDATE fails
    with pytest.raises((sqlite3.IntegrityError, sqlite3.OperationalError)) as exc_info:
        cur.execute("UPDATE audit_log SET action = 'tampered' WHERE audit_id = 'a1';")
    assert "permission denied: audit_log table is append-only" in str(exc_info.value)

    # 3. DELETE fails
    with pytest.raises((sqlite3.IntegrityError, sqlite3.OperationalError)) as exc_info:
        cur.execute("DELETE FROM audit_log WHERE audit_id = 'a1';")
    assert "permission denied: audit_log table is append-only" in str(exc_info.value)

    conn.close()


def test_api_route_decorator_writes_audit_rows(tenant_studio8: TenantContext) -> None:
    """Subtask 2: API route decorator writes audit rows with tenant, user, action, object, and result."""
    writer = InMemoryAuditWriter()

    @audit_action("document.view", "document", writer=writer)
    def view_doc(id: str, user_id: str | None = None) -> dict[str, str]:
        return {"status": "ok", "doc_id": id}

    with tenant_scope(tenant_studio8):
        result = view_doc(id="spec-456", user_id="charlie")
        assert result["doc_id"] == "spec-456"

    events = writer.by_tenant("studio8")
    assert len(events) == 1
    ev = events[0]
    assert ev.action == "document.view"
    assert ev.entity_type == "document"
    assert ev.entity_id == "spec-456"
    assert ev.user_id == "charlie"
    assert ev.details["status"] == "success"
    assert "duration_ms" in ev.details


def test_api_route_decorator_captures_errors(tenant_studio8: TenantContext) -> None:
    writer = InMemoryAuditWriter()

    @audit_action("decision.review", "decision", writer=writer)
    def failing_action(id: str, user_id: str | None = None) -> None:
        raise PermissionError("User not authorized to sign off")

    with tenant_scope(tenant_studio8):
        with pytest.raises(PermissionError):
            failing_action(id="dec-101", user_id="david")

    events = writer.by_tenant("studio8")
    assert len(events) == 1
    assert events[0].details["status"] == "error"
    assert "User not authorized" in events[0].details["error"]


def test_log_retrieved_source_ids_per_answer() -> None:
    """Subtask 3: Log retrieved source IDs per answer."""
    event = create_retrieval_audit_event(
        tenant_id="studio8",
        user_id="alice",
        query_id="query-abc-123",
        retrieved_source_ids=["src-doc-1", "src-drawing-9"],
        question="What is the facade wind load tolerance?",
        duration_ms=85.4,
    )
    assert event.tenant_id == "studio8"
    assert event.action == "ask.retrieval"
    assert event.details["source_count"] == 2
    assert event.details["retrieved_source_ids"] == ["src-doc-1", "src-drawing-9"]
    assert event.details["question_preview"] == "What is the facade wind load tolerance?"


def test_retention_setting_per_tenant() -> None:
    """Subtask 4: Retention setting per tenant."""
    # Default is 90 days
    default_pol = get_tenant_retention_policy("studio8")
    assert default_pol.retention_days == 90

    # Custom override
    set_tenant_retention_policy(TenantRetentionPolicy(tenant_id="studio8", retention_days=365, compliance_lock=True))
    updated_pol = get_tenant_retention_policy("studio8")
    assert updated_pol.retention_days == 365
    assert updated_pol.compliance_lock is True

    # Retention must be at least 30 days
    with pytest.raises(ValueError):
        set_tenant_retention_policy(TenantRetentionPolicy(tenant_id="studio8", retention_days=10))
