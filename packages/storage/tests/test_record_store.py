# Owner task: EB-53 · EB-66 · EB-24
"""SqlRecordStore: tenant isolation, compare-and-set, append-only audit, and refusal of unsafe input."""

from __future__ import annotations

import pytest

from storage import RecordConflictError, SqlRecordStore, create_app_engine
from storage.testing import sqlite_engine
from tenant_context import CrossTenantAccessError, NoTenantContextError, tenant_scope

COLS = {"tenant_id": "text", "decision_id": "text", "title": "text", "description": "text", "status": "text",
        "evidence_ids": "json", "version": "int"}


def row(tenant, did="d1", **kw):
    return {"tenant_id": tenant, "decision_id": did, "title": "t", "description": "d", "status": "proposed",
            "evidence_ids": ["ev_1"], "version": 1, **kw}


@pytest.fixture
def store():
    return SqlRecordStore(sqlite_engine(), "decisions", "decision_id", COLS, version_column="version")


def test_requires_a_tenant_context(store) -> None:
    with pytest.raises(NoTenantContextError):
        store.get("a", "d1")


def test_roundtrip_and_json_normalisation(ctx, store) -> None:
    with tenant_scope(ctx("tenant-a")):
        store.insert("tenant-a", row("tenant-a", evidence_ids=["ev_1", "ev_2"]))
        got = store.get("tenant-a", "d1")
    assert got["evidence_ids"] == ["ev_1", "ev_2"] and got["version"] == 1 and got["status"] == "proposed"


def test_tenants_cannot_read_write_or_update_each_other(ctx, store) -> None:
    with tenant_scope(ctx("tenant-a")):
        store.insert("tenant-a", row("tenant-a"))
    with tenant_scope(ctx("tenant-b")):
        store.insert("tenant-b", row("tenant-b", title="b's decision"))  # same key, different tenant: fine
        assert store.get("tenant-b", "d1")["title"] == "b's decision"
        assert [r["tenant_id"] for r in store.list("tenant-b")] == ["tenant-b"]
        with pytest.raises(CrossTenantAccessError):
            store.get("tenant-a", "d1")  # asking for another tenant by argument is refused outright
        with pytest.raises(CrossTenantAccessError):
            store.insert("tenant-b", row("tenant-a", did="x"))  # row stamped for a different tenant
        assert store.update_if_version("tenant-b", row("tenant-b", title="changed"), 1) is True
    with tenant_scope(ctx("tenant-a")):
        assert store.get("tenant-a", "d1")["title"] == "t"  # untouched by tenant-b's update


def test_compare_and_set_detects_concurrent_changes(ctx, store) -> None:
    with tenant_scope(ctx("tenant-a")):
        store.insert("tenant-a", row("tenant-a"))
        assert store.update_if_version("tenant-a", row("tenant-a", title="first", version=2), 1) is True
        assert store.update_if_version("tenant-a", row("tenant-a", title="stale", version=2), 1) is False  # lost the race
        assert store.get("tenant-a", "d1")["title"] == "first"


def test_duplicate_insert_is_a_conflict(ctx, store) -> None:
    with tenant_scope(ctx("tenant-a")):
        store.insert("tenant-a", row("tenant-a"))
        with pytest.raises(RecordConflictError):
            store.insert("tenant-a", row("tenant-a"))


def test_unsafe_identifiers_and_columns_are_refused(ctx, store) -> None:
    engine = sqlite_engine()
    with pytest.raises(ValueError):
        SqlRecordStore(engine, "decisions; DROP TABLE decisions", "decision_id", COLS, version_column="version")
    with pytest.raises(ValueError):
        SqlRecordStore(engine, "decisions", "decision_id", {**COLS, "x; --": "text"}, version_column="version")
    with tenant_scope(ctx("tenant-a")):
        with pytest.raises(ValueError):
            store.insert("tenant-a", {**row("tenant-a"), "evil": 1})
        with pytest.raises(ValueError):
            store.list("tenant-a", order_by="title; DROP TABLE decisions")
        store.insert("tenant-a", row("tenant-a", did="d2"))
        assert store.get("tenant-a", "d2' OR '1'='1") is None  # key is a bound parameter


def test_audit_table_is_append_only() -> None:
    from storage.record_store import SqlRecordStore as S

    cols = {"audit_id": "text", "tenant_id": "text", "user_id": "text", "action": "text", "entity_type": "text",
            "entity_id": "text", "details": "json", "ip_address": "text", "user_agent": "text", "created_at": "timestamp"}
    engine = sqlite_engine()
    audit = S(engine, "audit_log", "audit_id", cols, version_column=None)
    from tenant_context import Placement, TenantContext, TenantStatus, Tier

    p = Placement(cell_id="c", region="r", pg_cluster="p", pg_database="d", object_bucket="b", object_prefix="tenants/tenant-a/",
                  qdrant_cluster="q", qdrant_shard_key="s", opensearch_cluster="o", opensearch_index="i", opensearch_alias="a",
                  fga_store="f", temporal_namespace="n", temporal_queue_prefix="q", litellm_team="t", kms_key_ref="k")
    with tenant_scope(TenantContext("tenant-a", "tenant-a", TenantStatus.ACTIVE, Tier.POOL, p)):
        audit.insert("tenant-a", {"audit_id": "a1", "tenant_id": "tenant-a", "user_id": "u", "action": "x.y", "entity_type": "x",
                                  "entity_id": "1", "details": {"k": "v"}, "created_at": "2026-10-01T00:00:00+00:00"})
        assert audit.list("tenant-a")[0]["details"] == {"k": "v"}
        with pytest.raises(TypeError):
            audit.update_if_version("tenant-a", {"audit_id": "a1", "tenant_id": "tenant-a"}, 1)
    from sqlalchemy import text

    with engine.begin() as conn, pytest.raises(Exception, match="append-only"):
        conn.execute(text("UPDATE audit_log SET action = 'tampered'"))
    with engine.begin() as conn, pytest.raises(Exception, match="append-only"):
        conn.execute(text("DELETE FROM audit_log"))


@pytest.mark.parametrize("url", ["postgresql://postgres:pw@db/brain", "postgresql://klarity_admin:pw@db/brain",
                                 "postgresql://klarity_control:pw@db/x", "postgresql://klarity_infra:pw@db/x"])
def test_app_engine_refuses_privileged_database_roles(url) -> None:
    with pytest.raises(ValueError, match="klarity_app"):
        create_app_engine(url)
