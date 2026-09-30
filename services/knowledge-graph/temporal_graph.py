# Owner task: EB-44 Graph traversal (graph store) · EB-52 ontology tables use the same contract
"""Tenant-scoped temporal knowledge graph.

Nodes are entities with an ontology type; edges are typed, time-bounded relations. Every edge must pass the
ontology's type constraints (packages/ontology ``validate_relation``) and must cite at least one evidence id, so
the graph can never assert a relationship the Brain cannot show a source for (rule 4). Everything is keyed by the
active tenant: there is no API that reads across tenants (rule 1).

This is the in-memory reference implementation behind the contract; the Postgres ``edges`` table (RLS) is the
production backend with the same methods.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterable

from packages.ontology.graph import RelationType, validate_relation
from tenant_context import current_tenant

FAR_FUTURE = datetime(9999, 12, 31, tzinfo=timezone.utc)


class GraphError(Exception):
    pass


@dataclass(frozen=True)
class Node:
    entity_id: str
    entity_type: str
    name: str
    project_id: str | None = None


@dataclass(frozen=True)
class Edge:
    source: str
    relation: RelationType
    target: str
    evidence_ids: tuple[str, ...]
    valid_from: datetime
    valid_to: datetime = FAR_FUTURE
    source_ref: str | None = None

    def valid_at(self, at: datetime) -> bool:
        return self.valid_from <= at < self.valid_to


class KnowledgeGraph:
    def __init__(self) -> None:
        self._nodes: dict[tuple[str, str], Node] = {}
        self._edges: dict[str, list[Edge]] = {}  # tenant -> edges
        self._lock = threading.Lock()

    @staticmethod
    def _tenant() -> str:
        return current_tenant().tenant_id

    def add_node(self, node: Node) -> Node:
        with self._lock:
            self._nodes[(self._tenant(), node.entity_id)] = node
        return node

    def node(self, entity_id: str) -> Node | None:
        return self._nodes.get((self._tenant(), entity_id))

    def add_edge(self, source: str, relation: RelationType | str, target: str, *, evidence_ids: Iterable[str],
                 valid_from: datetime, valid_to: datetime = FAR_FUTURE, source_ref: str | None = None) -> Edge:
        src, tgt = self.node(source), self.node(target)
        if src is None or tgt is None:
            raise GraphError("both endpoints must exist in this tenant's graph")
        rel = RelationType(relation)
        ok, why = validate_relation(src.entity_type, rel, tgt.entity_type)
        if not ok:
            raise GraphError(why)
        evidence = tuple(evidence_ids)
        if not evidence:
            raise GraphError("an edge must cite evidence")
        if valid_to <= valid_from:
            raise GraphError("valid_to must be after valid_from")
        edge = Edge(source, rel, target, evidence, valid_from, valid_to, source_ref)
        with self._lock:
            bucket = self._edges.setdefault(self._tenant(), [])
            if edge not in bucket:  # idempotent re-ingestion
                bucket.append(edge)
        return edge

    def close_edge(self, edge: Edge, at: datetime) -> Edge:
        """End an edge's validity (the relation stopped being true). History is kept, never deleted."""
        with self._lock:
            bucket = self._edges.get(self._tenant(), [])
            try:
                i = bucket.index(edge)
            except ValueError as exc:
                raise GraphError("edge not found in this tenant") from exc
            closed = Edge(edge.source, edge.relation, edge.target, edge.evidence_ids, edge.valid_from, at, edge.source_ref)
            bucket[i] = closed
        return closed

    def edges_of(self, entity_id: str, *, at: datetime | None = None,
                 relations: frozenset[RelationType] | None = None) -> list[Edge]:
        """Edges touching ``entity_id`` in either direction, valid at ``at`` (default: all history)."""
        out = [e for e in self._edges.get(self._tenant(), [])
               if entity_id in (e.source, e.target)
               and (relations is None or e.relation in relations)
               and (at is None or e.valid_at(at))]
        return sorted(out, key=lambda e: (e.valid_from, e.source, e.relation.value, e.target))
