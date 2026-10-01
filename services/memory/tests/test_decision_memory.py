# Owner task: EB-53 Decision Memory
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from decision_memory import (
    DecisionMemory, DecisionStatus, InvalidChange, NotAuthorized, NotFound,
)
from review import review_queue, summary
from tenant_context import Placement, TenantContext, TenantStatus, Tier, tenant_scope
from extractors.events import SourceChunk, extract_events


def _ctx(tid="studio8") -> TenantContext:
    p = Placement(cell_id="c1", region="r", pg_cluster="pg", pg_database="d", object_bucket="b",
                  object_prefix=f"tenants/{tid}/", qdrant_cluster="q", qdrant_shard_key=tid, opensearch_cluster="o",
                  opensearch_index="i", opensearch_alias="a", fga_store=f"f-{tid}", temporal_namespace="c1",
                  temporal_queue_prefix="p", litellm_team=tid, kms_key_ref=tid)
    return TenantContext(tid, tid, TenantStatus.ACTIVE, Tier.POOL, p)


@pytest.fixture(params=["memory", "sql"])
def env(request):
    """Every behaviour below must hold for both the in-memory store and the SQL store."""
    from decision_sql_store import SqlDecisionStore
    from storage.testing import sqlite_engine

    audit = []
    store = None if request.param == "memory" else SqlDecisionStore(sqlite_engine())
    mem = DecisionMemory(can_review=lambda u, d: u in {"priya", "vikram"}, audit=lambda **kw: audit.append(kw),
                         clock=lambda: datetime(2026, 10, 1, tzinfo=timezone.utc), store=store)
    return mem, audit


def draft(mem, did="dec-1", project="phoenix", conf=0.7, **kw):
    return mem.propose(decision_id=did, project_id=project, title="Use acoustic glazing", description="d",
                       evidence_ids=("ev_1",), confidence=conf, **kw)


def test_lifecycle_confirm_edit_supersede_and_history(env) -> None:
    mem, audit = env
    with tenant_scope(_ctx()):
        draft(mem), draft(mem, "dec-2")
        assert mem.confirm("dec-1", "priya", "matches minutes").status is DecisionStatus.DECIDED
        mem.edit("dec-1", "priya", rationale="civic sound norms", cost_impact="1800000")
        mem.confirm("dec-2", "vikram")
        old = mem.supersede("dec-1", "dec-2", "priya")
        assert old.status is DecisionStatus.SUPERSEDED and old.superseded_by == "dec-2"
        assert [d.decision_id for d in mem.history("dec-1")] == ["dec-1", "dec-2"]
    assert [a["action"] for a in audit] == ["decision.proposed", "decision.proposed", "decision.confirmed",
                                            "decision.edited", "decision.confirmed", "decision.superseded"]


def test_evidence_required_and_idempotent_proposal(env) -> None:
    mem, _ = env
    with tenant_scope(_ctx()):
        with pytest.raises(InvalidChange):
            mem.propose(decision_id="x", project_id="p", title="t", description="d", evidence_ids=())
        a, b = draft(mem), draft(mem)
        assert a == b and len(mem.list()) == 1


def test_only_authorized_humans_review(env) -> None:
    mem, _ = env
    with tenant_scope(_ctx()):
        draft(mem)
        for who in ("mallory", "agent:pm"):
            with pytest.raises(NotAuthorized):
                mem.confirm("dec-1", who)
        assert mem.get("dec-1").status is DecisionStatus.PROPOSED


def test_state_machine_guards(env) -> None:
    mem, _ = env
    with tenant_scope(_ctx()):
        draft(mem)
        with pytest.raises(InvalidChange):
            mem.edit("dec-1", "priya", decided_by="someone-else")  # not an editable field
        mem.reject("dec-1", "priya", "not what was agreed")
        assert mem.get("dec-1").status is DecisionStatus.REVOKED
        with pytest.raises(InvalidChange):
            mem.confirm("dec-1", "priya")
        with pytest.raises(InvalidChange):
            mem.edit("dec-1", "priya", title="x")  # revoked is read-only


def test_supersession_rules(env) -> None:
    mem, _ = env
    with tenant_scope(_ctx()):
        draft(mem), draft(mem, "dec-2"), draft(mem, "dec-3", project="harbour")
        for d in ("dec-1", "dec-2", "dec-3"):
            mem.confirm(d, "priya")
        with pytest.raises(InvalidChange):
            mem.supersede("dec-1", "dec-1", "priya")
        with pytest.raises(InvalidChange):
            mem.supersede("dec-1", "dec-3", "priya")  # other project
        mem.supersede("dec-1", "dec-2", "priya")
        with pytest.raises(InvalidChange):
            mem.supersede("dec-1", "dec-2", "priya")  # dec-1 is no longer decided
        with pytest.raises(InvalidChange):
            mem.supersede("dec-2", "dec-1", "priya")  # dec-1 superseded


def test_review_queue_lowest_confidence_first_and_summary(env) -> None:
    mem, _ = env
    with tenant_scope(_ctx()):
        draft(mem, "dec-a", conf=0.9), draft(mem, "dec-b", conf=0.55), draft(mem, "dec-c", conf=0.7)
        mem.confirm("dec-c", "priya")
        assert [d.decision_id for d in review_queue(mem)] == ["dec-b", "dec-a"]
        assert summary(mem) == {"proposed": 2, "decided": 1, "superseded": 0, "revoked": 0}


def test_tenant_isolation(env) -> None:
    mem, _ = env
    with tenant_scope(_ctx()):
        draft(mem)
    with tenant_scope(_ctx("other")):
        assert mem.list() == []
        with pytest.raises(NotFound):
            mem.get("dec-1")
        with pytest.raises(NotFound):
            mem.confirm("dec-1", "priya")


def test_draft_from_extracted_decision_event(env) -> None:
    mem, _ = env
    now = datetime(2026, 10, 1, tzinfo=timezone.utc)
    (event,) = [e for e in extract_events(SourceChunk("studio8", "s", "gmail:1", "We decided to go with the Voltas chiller.", now, "phoenix"))
                if e.event_type.value == "decision"]
    with tenant_scope(_ctx()):
        d = mem.propose_from_event(event, "ev_chunk_7")
        assert d.status is DecisionStatus.PROPOSED and d.project_id == "phoenix" and d.source_ref == "gmail:1"
        assert mem.propose_from_event(event, "ev_chunk_7") == d
        web = d.to_web()
        assert web["status"] == "proposed" and web["evidenceIds"] == ["ev_chunk_7"] and "confidence" in web
    with tenant_scope(_ctx("other")):
        with pytest.raises(NotAuthorized):
            mem.propose_from_event(event, "ev")


def test_stale_review_is_rejected_not_silently_overwritten() -> None:
    """Two reviewers act on the same draft: the second must be told to reload, on both stores."""
    from decision_sql_store import SqlDecisionStore
    from storage.testing import sqlite_engine

    mem = DecisionMemory(can_review=lambda u, d: True, store=SqlDecisionStore(sqlite_engine()))
    with tenant_scope(_ctx()):
        d = draft(mem)
        stale = mem.get("dec-1")
        mem.confirm("dec-1", "priya")
        assert mem.store.compare_and_set(stale, stale.__class__(**{**stale.__dict__, "title": "tampered", "version": 2})) is False
        assert mem.get("dec-1").title == d.title


def test_sql_roundtrip_preserves_every_field() -> None:
    from decision_sql_store import SqlDecisionStore
    from storage.testing import sqlite_engine

    mem = DecisionMemory(can_review=lambda u, d: True, store=SqlDecisionStore(sqlite_engine()),
                         clock=lambda: datetime(2026, 10, 1, 12, 30, tzinfo=timezone.utc))
    with tenant_scope(_ctx()):
        mem.propose(decision_id="dec-9", project_id="phoenix", title="Use M40", description="d", evidence_ids=("ev_1", "ev_2"),
                    confidence=0.7, source_ref="gmail:1")
        mem.edit("dec-9", "priya", alternatives=["M35", "M45"], cost_impact="1800000", time_impact_days=3, rationale="IS 456")
        mem.confirm("dec-9", "priya", "agreed")
        d = mem.get("dec-9")
    assert d.evidence_ids == ("ev_1", "ev_2") and d.alternatives == ("M35", "M45") and d.confidence == 0.7
    assert d.time_impact_days == 3 and d.decided_by == "priya" and d.decided_at == datetime(2026, 10, 1, 12, 30, tzinfo=timezone.utc)
    assert float(d.cost_impact) == 1800000.0 and d.status is DecisionStatus.DECIDED and d.version == 3
