# Owner task: EB-41 Entity resolution cascade
from __future__ import annotations

import pytest

from cascade import Outcome, ResolutionCascade
from resolver import EntityRecord, Mention, jaro_winkler, normalize_name, normalize_phone
from review_queue import ReviewError, ReviewQueue, ReviewStatus
from tenant_context import Placement, TenantContext, TenantStatus, Tier, tenant_scope

T = "studio8"


def _ctx(tid: str = T) -> TenantContext:
    p = Placement(cell_id="c1", region="r", pg_cluster="pg", pg_database="d", object_bucket="b",
                  object_prefix=f"tenants/{tid}/", qdrant_cluster="q", qdrant_shard_key=tid, opensearch_cluster="o",
                  opensearch_index="i", opensearch_alias="a", fga_store=f"f-{tid}", temporal_namespace="c1",
                  temporal_queue_prefix="p", litellm_team=tid, kms_key_ref=tid)
    return TenantContext(tid, tid, TenantStatus.ACTIVE, Tier.POOL, p)


def ent(eid, name, etype="company", **kw):
    return EntityRecord(T, eid, etype, name, **kw)


def men(name, etype="company", **kw):
    return Mention(T, etype, name, "gmail:msg1", **kw)


@pytest.fixture
def entities():
    return [
        ent("sharma", "Sharma Constructions Pvt. Ltd.", aliases=("SCPL",), tax_id="27ABCDE1234F1Z5", email="accounts@sharma.in"),
        ent("tower-a", "Tower A", etype="building"),
        ent("tower-b", "Tower B", etype="building"),
        ent("ravi", "Ravi Kumar", etype="person", phone="+91 98480 11111"),
        ent("ravi2", "Ravi Kumar", etype="person", phone="+91 99999 22222"),
    ]


def test_normalisation_folds_legal_forms_plurals_and_honorifics() -> None:
    assert normalize_name("M/s Sharma Constructions Pvt. Ltd.") == normalize_name("Sharma Construction Private Limited")
    assert normalize_name("Shri Ravi Kumar", person=True) == "ravi kumar"
    assert normalize_phone("+91 98480-11111") == "9848011111"
    assert jaro_winkler("martha", "marhta") > 0.95


def test_identifier_stage_beats_name_and_is_tenant_safe(entities) -> None:
    with tenant_scope(_ctx()):
        d = ResolutionCascade().resolve(men("Accounts Dept", email="ACCOUNTS@sharma.in"), entities)
        assert (d.outcome, d.stage, d.entity_id) == (Outcome.MATCH, "identifier", "sharma")
        d = ResolutionCascade().resolve(men("Somebody", etype="person", phone="098480 11111"), entities)
        assert (d.outcome, d.entity_id) == (Outcome.MATCH, "ravi")
        with pytest.raises(PermissionError):
            ResolutionCascade().resolve(Mention("other", "company", "X", "s"), entities)


def test_exact_normalised_name_and_alias(entities) -> None:
    with tenant_scope(_ctx()):
        c = ResolutionCascade()
        assert c.resolve(men("Sharma Construction Private Limited"), entities).entity_id == "sharma"
        assert c.resolve(men("scpl"), entities).entity_id == "sharma"


def test_ambiguous_exact_name_goes_to_review_never_guesses(entities) -> None:
    with tenant_scope(_ctx()):
        d = ResolutionCascade().resolve(men("Ravi Kumar", etype="person"), entities)
    assert d.outcome is Outcome.REVIEW and {c.entity_id for c in d.candidates} == {"ravi", "ravi2"}


def test_designator_clash_never_auto_merges(entities) -> None:
    with tenant_scope(_ctx()):
        d = ResolutionCascade().resolve(men("Tower C", etype="building"), entities)
    assert d.outcome is not Outcome.MATCH


def test_conflicting_tax_id_blocks_name_match(entities) -> None:
    with tenant_scope(_ctx()):
        d = ResolutionCascade().resolve(men("Sharma Constructions Pvt Ltd", tax_id="29ZZZZZ9999Z1Z1"), entities)
    assert d.outcome is Outcome.NEW or d.entity_id != "sharma"


def test_typo_matches_and_unrelated_is_new(entities) -> None:
    with tenant_scope(_ctx()):
        c = ResolutionCascade()
        assert c.resolve(men("Sharma Constuctions Pvt Ltd"), entities).entity_id == "sharma"
        assert c.resolve(men("Zenith Steel Traders"), entities).outcome is Outcome.NEW


def test_entity_type_is_a_hard_block(entities) -> None:
    with tenant_scope(_ctx()):
        d = ResolutionCascade().resolve(men("Tower A", etype="company"), entities)
    assert d.outcome is Outcome.NEW


def test_review_accept_reject_and_cannot_link(entities) -> None:
    audit = []
    q = ReviewQueue(audit=lambda **kw: audit.append(kw))
    with tenant_scope(_ctx()):
        c = ResolutionCascade()
        m = men("Ravi Kumar", etype="person")
        d = c.resolve(m, entities)
        item = q.enqueue(m, d)
        assert q.enqueue(m, d) is item and len(q.pending()) == 1  # idempotent
        with pytest.raises(ReviewError):
            q.accept(item.item_id, "not-a-candidate", "asha")
        done = q.accept(item.item_id, "ravi", "asha")
        assert done.status is ReviewStatus.ACCEPTED and audit[-1]["action"] == "entity.alias_added"
        with pytest.raises(ReviewError):
            q.accept(item.item_id, "ravi", "asha")  # already decided
        # the reviewer said it is not ravi2: never proposed again
        again = c.resolve(m, entities, rejected=q.rejected_pairs())
        assert "ravi2" not in {x.entity_id for x in again.candidates}


def test_review_queue_is_tenant_scoped(entities) -> None:
    q = ReviewQueue()
    with tenant_scope(_ctx()):
        m = men("Ravi Kumar", etype="person")
        item = q.enqueue(m, ResolutionCascade().resolve(m, entities))
    with tenant_scope(_ctx("other")):
        assert q.pending() == []
        with pytest.raises(ReviewError):
            q.accept(item.item_id, "ravi", "mallory")
