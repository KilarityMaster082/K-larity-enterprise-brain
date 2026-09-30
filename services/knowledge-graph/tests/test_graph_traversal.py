# Owner task: EB-44 Graph traversal
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from facts import FactError, FactStore
from temporal_graph import GraphError, KnowledgeGraph, Node
from packages.ontology.graph import RelationType as R
from tenant_context import Placement, TenantContext, TenantStatus, Tier, tenant_scope
from traverse import expand

D = lambda m, d=1: datetime(2026, m, d, tzinfo=timezone.utc)  # noqa: E731


def _ctx(tid="studio8") -> TenantContext:
    p = Placement(cell_id="c1", region="r", pg_cluster="pg", pg_database="d", object_bucket="b",
                  object_prefix=f"tenants/{tid}/", qdrant_cluster="q", qdrant_shard_key=tid, opensearch_cluster="o",
                  opensearch_index="i", opensearch_alias="a", fga_store=f"f-{tid}", temporal_namespace="c1",
                  temporal_queue_prefix="p", litellm_team=tid, kms_key_ref=tid)
    return TenantContext(tid, tid, TenantStatus.ACTIVE, Tier.POOL, p)


@pytest.fixture
def g():
    graph = KnowledgeGraph()
    with tenant_scope(_ctx()):
        for n in [Node("phoenix", "Project", "Project Phoenix"), Node("co117", "ChangeOrder", "CO-117", "phoenix"),
                  Node("priya", "Person", "Priya Sharma"), Node("sharma", "Vendor", "Sharma Constructions"),
                  Node("d1", "Decision", "Acoustic glazing"), Node("d0", "Decision", "Standard glazing"),
                  Node("secret", "Person", "Restricted Person")]:
            graph.add_node(n)
        graph.add_edge("co117", R.APPROVED_BY, "priya", evidence_ids=["ev_1"], valid_from=D(9))
        graph.add_edge("sharma", R.CONTRACTED_TO, "phoenix", evidence_ids=["ev_2"], valid_from=D(1))
        graph.add_edge("d1", R.SUPERSEDES, "d0", evidence_ids=["ev_3"], valid_from=D(9))
        graph.add_edge("priya", R.WORKS_FOR, "sharma", evidence_ids=["ev_4"], valid_from=D(1))  # chain: co117→priya→sharma→phoenix
        graph.add_edge("d1", R.APPROVED_BY, "secret", evidence_ids=["ev_5"], valid_from=D(9))
    return graph


def test_ontology_constraints_and_evidence_enforced(g) -> None:
    with tenant_scope(_ctx()):
        with pytest.raises(GraphError):
            g.add_edge("priya", R.APPROVED_BY, "co117", evidence_ids=["e"], valid_from=D(1))  # wrong direction/types
        with pytest.raises(GraphError):
            g.add_edge("co117", R.APPROVED_BY, "priya", evidence_ids=[], valid_from=D(1))
        with pytest.raises(GraphError):
            g.add_edge("co117", R.APPROVED_BY, "ghost", evidence_ids=["e"], valid_from=D(1))
        with pytest.raises(GraphError):
            g.add_edge("co117", R.APPROVED_BY, "priya", evidence_ids=["e"], valid_from=D(5), valid_to=D(4))


def test_multi_hop_paths_carry_evidence_and_respect_hop_budget(g) -> None:
    with tenant_scope(_ctx()):
        two = {r.entity_id: r for r in expand(g, ["co117"], can_view=lambda n: True, max_hops=2)}
        assert {"priya", "sharma"} <= set(two) and "phoenix" not in two  # phoenix is 3 hops away
        assert two["sharma"].hops == 2 and two["sharma"].evidence_ids == ("ev_1", "ev_4")
        three = {r.entity_id for r in expand(g, ["co117"], can_view=lambda n: True, max_hops=3)}
        assert "phoenix" in three
        with pytest.raises(ValueError):
            expand(g, ["co117"], can_view=lambda n: True, max_hops=9)


def test_restricted_nodes_are_neither_returned_nor_walked_through(g) -> None:
    with tenant_scope(_ctx()):
        res = expand(g, ["d1"], can_view=lambda n: n.entity_id != "secret", max_hops=3)
        ids = {r.entity_id for r in res}
        assert "secret" not in ids and "d0" in ids
        # the only route to the rest of the graph from `secret` is blocked, not leaked around
        assert expand(g, ["secret"], can_view=lambda n: n.entity_id != "secret") == []


def test_temporal_edges_and_close(g) -> None:
    with tenant_scope(_ctx()):
        assert {r.entity_id for r in expand(g, ["co117"], can_view=lambda n: True, at=D(8))} == set()  # approval is from Sept
        (edge,) = [e for e in g.edges_of("co117") if e.relation is R.APPROVED_BY]
        g.close_edge(edge, D(9, 15))
        assert g.edges_of("co117", at=D(9, 20)) == [] and len(g.edges_of("co117")) == 1  # history kept


def test_node_budget_cycles_and_determinism(g) -> None:
    with tenant_scope(_ctx()):
        a = expand(g, ["co117"], can_view=lambda n: True, max_hops=3, max_nodes=2)
        assert len(a) == 2
        full = expand(g, ["co117", "co117"], can_view=lambda n: True, max_hops=3)
        assert full == expand(g, ["co117"], can_view=lambda n: True, max_hops=3)
        assert len({r.entity_id for r in full}) == len(full)  # no duplicates despite the loop through sharma/phoenix


def test_graph_is_tenant_scoped(g) -> None:
    with tenant_scope(_ctx("other")):
        assert g.node("co117") is None
        assert expand(g, ["co117"], can_view=lambda n: True) == []
        with pytest.raises(GraphError):
            g.add_edge("co117", R.APPROVED_BY, "priya", evidence_ids=["e"], valid_from=D(1))


def test_temporal_facts_keep_history_and_reject_unsourced() -> None:
    fs = FactStore()
    with tenant_scope(_ctx()):
        fs.assert_fact("phoenix", "contract_value", "250000000", evidence_ids=("ev_a",), valid_from=D(1))
        same = fs.assert_fact("phoenix", "contract_value", "250000000", evidence_ids=("ev_a",), valid_from=D(3))
        assert same.valid_from == D(1) and len(fs.history("phoenix", "contract_value")) == 1
        fs.assert_fact("phoenix", "contract_value", "268000000", evidence_ids=("ev_b",), valid_from=D(9))
        assert fs.value_at("phoenix", "contract_value", D(6)).value == "250000000"
        assert fs.value_at("phoenix", "contract_value", D(10)).value == "268000000"
        assert fs.value_at("phoenix", "contract_value", D(12, 1)).evidence_ids == ("ev_b",)
        with pytest.raises(FactError):
            fs.assert_fact("phoenix", "contract_value", "1", evidence_ids=(), valid_from=D(10))
        with pytest.raises(FactError):
            fs.assert_fact("phoenix", "contract_value", "999", evidence_ids=("e",), valid_from=D(2))
    with tenant_scope(_ctx("other")):
        assert fs.value_at("phoenix", "contract_value", D(10)) is None
