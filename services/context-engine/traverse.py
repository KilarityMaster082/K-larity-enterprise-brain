# Owner task: EB-44 Graph traversal
"""Bounded, permission-aware graph expansion for related context.

Given the entities a question is about, walk the knowledge graph a few hops to find what else is relevant (the
approver of a change order, the vendor behind an invoice, the decision a drawing superseded) and return it with
the path and evidence that justify each hit.

Guarantees: hop and node budgets (a hub entity cannot explode the context); cycle-safe; deterministic order;
temporal (``at`` picks edges valid then); and permission-first (CLAUDE.md rule 2) — an entity the caller may not
see is neither returned nor walked *through*, so restricted nodes cannot leak via their neighbours.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Iterable

from temporal_graph import Edge, KnowledgeGraph, Node

MAX_HOPS = 3


@dataclass(frozen=True)
class RelatedEntity:
    entity_id: str
    name: str
    entity_type: str
    hops: int
    path: tuple[Edge, ...]  # edges from a seed to this entity

    @property
    def evidence_ids(self) -> tuple[str, ...]:
        seen: dict[str, None] = {}
        for edge in self.path:
            seen.update(dict.fromkeys(edge.evidence_ids))
        return tuple(seen)


def expand(graph: KnowledgeGraph, seeds: Iterable[str], *, can_view: Callable[[Node], bool], at: datetime | None = None,
           max_hops: int = 2, max_nodes: int = 25) -> list[RelatedEntity]:
    if not 1 <= max_hops <= MAX_HOPS:
        raise ValueError(f"max_hops must be between 1 and {MAX_HOPS}")
    visited: set[str] = set()
    queue: deque[tuple[str, int, tuple[Edge, ...]]] = deque()
    for seed in dict.fromkeys(seeds):
        node = graph.node(seed)
        if node is not None and can_view(node):
            visited.add(seed)
            queue.append((seed, 0, ()))
    results: list[RelatedEntity] = []
    while queue and len(results) < max_nodes:
        current, depth, path = queue.popleft()
        if depth == max_hops:
            continue
        for edge in graph.edges_of(current, at=at):
            other = edge.target if edge.source == current else edge.source
            if other in visited:
                continue
            node = graph.node(other)
            if node is None or not can_view(node):
                continue  # never return or traverse through what the caller may not see
            visited.add(other)
            new_path = path + (edge,)
            results.append(RelatedEntity(other, node.name, node.entity_type, depth + 1, new_path))
            queue.append((other, depth + 1, new_path))
            if len(results) >= max_nodes:
                break
    return results
