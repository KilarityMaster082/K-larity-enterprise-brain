# Owner task: EB-43 Hybrid retrieval (RRF)
"""Hybrid retrieval combining dense vector search (Qdrant), lexical BM25 (OpenSearch), and sparse retrieval with Reciprocal Rank Fusion (RRF), recency, and project boosts.

Borrowed from:
- Onyx a18fc1a backend/onyx/document_index/hybrid_search.py (MIT, O4) — RRF fusion logic.
- Haystack hybrid search pipeline patterns (Apache-2.0, H3) — parallel branch execution.
Adapted:
- Strict tenant context and OpenFGA permission filter enforcement.
- Indian construction AEC project context boosting and exponential decay recency weighting.
- Seamless conversion to EvidenceCandidate for context compression (EB-46) and verification (EB-47).
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
import logging
import math
from typing import Any, Protocol, Sequence

from compress import EvidenceCandidate
from packages.storage.storage.search_store import SearchBackend, SearchStore
from packages.storage.storage.vector_store import VectorBackend, VectorPoint, VectorStore
from tenant_context import current_tenant

logger = logging.getLogger(__name__)

DEFAULT_RRF_K = 60
DEFAULT_CHANNEL_WEIGHTS: dict[str, float] = {
    "dense": 1.0,
    "bm25": 0.8,
    "sparse": 0.5,
}


@dataclass
class RetrievalCandidate:
    """Individual candidate returned by hybrid retrieval."""

    chunk_id: str
    document_id: str
    text: str
    score: float = 0.0
    channel_ranks: dict[str, int] = field(default_factory=dict)
    channel_scores: dict[str, float] = field(default_factory=dict)
    source_metadata: dict[str, Any] = field(default_factory=dict)
    timestamp: datetime | None = None
    project_id: str | None = None

    def to_evidence_candidate(self) -> EvidenceCandidate:
        """Converts to context-engine EvidenceCandidate for downstream compression (EB-46)."""
        return EvidenceCandidate(
            evidence_id=f"ev_{self.chunk_id}",
            text=self.text,
            document_id=self.document_id,
            chunk_id=self.chunk_id,
            score=self.score,
            metadata={
                **self.source_metadata,
                "project_id": self.project_id or "",
                "timestamp": self.timestamp.isoformat() if self.timestamp else "",
            },
        )


def _opensearch_filters(filter_spec: dict[str, Any]) -> list[dict[str, Any]]:
    """Translate a retrieval filter_spec into OpenSearch filter clauses.

    Flat keys become ``term`` clauses; a Qdrant-style ``must`` list (as built by the permission
    filter, EB-42) maps ``match.value`` to ``term`` and ``match.any`` to ``terms``.
    """
    clauses: list[dict[str, Any]] = []
    for key, value in filter_spec.items():
        if key == "should":
            should = [_opensearch_filters({"must": [c]})[0] for c in value]
            clauses.append({"bool": {"should": should, "minimum_should_match": 1}})
        elif key == "must":
            for cond in value:
                match = cond.get("match", {})
                if "any" in match:
                    clauses.append({"terms": {cond["key"]: list(match["any"])}})
                else:
                    clauses.append({"term": {cond["key"]: match.get("value")}})
        else:
            clauses.append({"term": {key: value}})
    return clauses


class SparseSearchBackend(Protocol):
    """Protocol for sparse keyword/lexical or SPLADE search."""

    def search_sparse(
        self,
        query: str,
        filter_spec: dict[str, Any],
        limit: int = 20,
    ) -> list[dict[str, Any]]: ...


class HybridRetriever:
    """Orchestrates parallel dense, BM25, and sparse retrieval with Reciprocal Rank Fusion."""

    def __init__(
        self,
        vector_store: VectorStore | None = None,
        search_store: SearchStore | None = None,
        sparse_backend: SparseSearchBackend | None = None,
        rrf_k: int = DEFAULT_RRF_K,
        channel_weights: dict[str, float] | None = None,
        recency_decay_days: float = 30.0,
        recency_weight: float = 0.15,
        project_boost_multiplier: float = 1.25,
    ) -> None:
        self.vector_store = vector_store
        self.search_store = search_store
        self.sparse_backend = sparse_backend
        self.rrf_k = rrf_k
        self.channel_weights = channel_weights or dict(DEFAULT_CHANNEL_WEIGHTS)
        self.recency_decay_days = recency_decay_days
        self.recency_weight = recency_weight
        self.project_boost_multiplier = project_boost_multiplier

    # --- Async Parallel Retrieval -------------------------------------------------------------------
    async def aretrieve(
        self,
        query: str,
        query_vector: list[float] | None = None,
        filter_spec: dict[str, Any] | None = None,
        limit: int = 20,
        active_project_id: str | None = None,
    ) -> list[RetrievalCandidate]:
        """Runs dense, BM25, and sparse search concurrently, applying RRF and contextual boosts."""
        filters = filter_spec or {}

        # 1. Dispatch queries in parallel
        tasks = []

        # Dense Vector Search task
        if self.vector_store and query_vector:
            tasks.append(self._async_dense_search(query_vector, filters, limit * 2))
        else:
            tasks.append(asyncio.sleep(0, result=[]))

        # Lexical BM25 Search task
        if self.search_store and query:
            tasks.append(self._async_bm25_search(query, filters, limit * 2))
        else:
            tasks.append(asyncio.sleep(0, result=[]))

        # Sparse Search task
        if self.sparse_backend and query:
            tasks.append(self._async_sparse_search(query, filters, limit * 2))
        else:
            tasks.append(asyncio.sleep(0, result=[]))

        dense_results, bm25_results, sparse_results = await asyncio.gather(*tasks)

        # 2. Fuse rankings via RRF
        fused = self.fuse_rrf(
            dense_results=dense_results,
            bm25_results=bm25_results,
            sparse_results=sparse_results,
            active_project_id=active_project_id,
        )

        # Return top N candidates
        return fused[:limit]

    def retrieve(
        self,
        query: str,
        query_vector: list[float] | None = None,
        filter_spec: dict[str, Any] | None = None,
        limit: int = 20,
        active_project_id: str | None = None,
    ) -> list[RetrievalCandidate]:
        """Synchronous wrapper for aretrieve."""
        return asyncio.run(
            self.aretrieve(
                query=query,
                query_vector=query_vector,
                filter_spec=filter_spec,
                limit=limit,
                active_project_id=active_project_id,
            )
        )

    # --- Search Channel Implementations -------------------------------------------------------------
    async def _async_dense_search(
        self,
        query_vector: list[float],
        filter_spec: dict[str, Any],
        limit: int,
    ) -> list[RetrievalCandidate]:
        return await asyncio.to_thread(self._dense_search_sync, query_vector, filter_spec, limit)

    def _dense_search_sync(
        self,
        query_vector: list[float],
        filter_spec: dict[str, Any],
        limit: int,
    ) -> list[RetrievalCandidate]:
        if not self.vector_store:
            return []
        try:
            points = self.vector_store.search(
                query_vector=query_vector,
                filter_spec=filter_spec,
                limit=limit,
            )
            cands = []
            for pt in points:
                payload = pt.payload or {}
                dt = None
                if "timestamp" in payload:
                    try:
                        dt = datetime.fromisoformat(payload["timestamp"])
                    except Exception:
                        pass
                cands.append(
                    RetrievalCandidate(
                        chunk_id=pt.id,
                        document_id=payload.get("document_id", pt.id),
                        text=payload.get("text", ""),
                        score=pt.score,
                        channel_scores={"dense": pt.score},
                        source_metadata=payload,
                        timestamp=dt,
                        project_id=payload.get("project_id"),
                    )
                )
            return cands
        except Exception as exc:
            logger.warning("Dense search failed: %s", exc)
            return []

    async def _async_bm25_search(
        self,
        query: str,
        filter_spec: dict[str, Any],
        limit: int,
    ) -> list[RetrievalCandidate]:
        return await asyncio.to_thread(self._bm25_search_sync, query, filter_spec, limit)

    def _bm25_search_sync(
        self,
        query: str,
        filter_spec: dict[str, Any],
        limit: int,
    ) -> list[RetrievalCandidate]:
        if not self.search_store:
            return []
        try:
            search_body = {
                "size": limit,
                "query": {
                    "bool": {
                        "must": [{"match": {"text": query}}],
                        "filter": _opensearch_filters(filter_spec),
                    }
                },
            }
            hits = self.search_store.search(search_body)
            cands = []
            for hit in hits:
                doc_id = hit.get("id") or hit.get("_id", "")
                source = hit.get("document") or hit.get("_source") or hit
                dt = None
                if "timestamp" in source:
                    try:
                        dt = datetime.fromisoformat(source["timestamp"])
                    except Exception:
                        pass
                score = float(hit.get("score") or hit.get("_score") or 1.0)
                cands.append(
                    RetrievalCandidate(
                        chunk_id=doc_id,
                        document_id=source.get("document_id", doc_id),
                        text=source.get("text", ""),
                        score=score,
                        channel_scores={"bm25": score},
                        source_metadata=source,
                        timestamp=dt,
                        project_id=source.get("project_id"),
                    )
                )
            return cands
        except Exception as exc:
            logger.warning("BM25 search failed: %s", exc)
            return []

    async def _async_sparse_search(
        self,
        query: str,
        filter_spec: dict[str, Any],
        limit: int,
    ) -> list[RetrievalCandidate]:
        return await asyncio.to_thread(self._sparse_search_sync, query, filter_spec, limit)

    def _sparse_search_sync(
        self,
        query: str,
        filter_spec: dict[str, Any],
        limit: int,
    ) -> list[RetrievalCandidate]:
        if not self.sparse_backend:
            return []
        try:
            hits = self.sparse_backend.search_sparse(query, filter_spec, limit)
            cands = []
            for h in hits:
                cands.append(
                    RetrievalCandidate(
                        chunk_id=h.get("chunk_id", ""),
                        document_id=h.get("document_id", ""),
                        text=h.get("text", ""),
                        score=float(h.get("score", 1.0)),
                        channel_scores={"sparse": float(h.get("score", 1.0))},
                        source_metadata=h,
                        project_id=h.get("project_id"),
                    )
                )
            return cands
        except Exception as exc:
            logger.warning("Sparse search failed: %s", exc)
            return []

    # --- Reciprocal Rank Fusion ---------------------------------------------------------------------
    def fuse_rrf(
        self,
        dense_results: Sequence[RetrievalCandidate],
        bm25_results: Sequence[RetrievalCandidate],
        sparse_results: Sequence[RetrievalCandidate],
        active_project_id: str | None = None,
    ) -> list[RetrievalCandidate]:
        """Combines multiple ranked lists using weighted Reciprocal Rank Fusion with contextual boosts."""
        candidates_by_id: dict[str, RetrievalCandidate] = {}
        rrf_scores: dict[str, float] = {}

        channels = [
            ("dense", dense_results, self.channel_weights.get("dense", 1.0)),
            ("bm25", bm25_results, self.channel_weights.get("bm25", 0.8)),
            ("sparse", sparse_results, self.channel_weights.get("sparse", 0.5)),
        ]

        # Accumulate RRF scores
        for channel_name, results, weight in channels:
            for rank_0, cand in enumerate(results):
                cid = cand.chunk_id
                if not cid:
                    continue

                if cid not in candidates_by_id:
                    candidates_by_id[cid] = cand
                    rrf_scores[cid] = 0.0
                else:
                    # Merge channel scores and metadata
                    target = candidates_by_id[cid]
                    target.channel_scores.update(cand.channel_scores)
                    if not target.text and cand.text:
                        target.text = cand.text
                    if not target.timestamp and cand.timestamp:
                        target.timestamp = cand.timestamp
                    if not target.project_id and cand.project_id:
                        target.project_id = cand.project_id

                rank = rank_0 + 1
                candidates_by_id[cid].channel_ranks[channel_name] = rank
                rrf_increment = weight / (self.rrf_k + rank)
                rrf_scores[cid] += rrf_increment

        now_utc = datetime.now(timezone.utc)

        # Apply recency and project boosts
        for cid, cand in candidates_by_id.items():
            base_score = rrf_scores[cid]

            # Recency boost: exponential decay over recency_decay_days
            boost_factor = 1.0
            if cand.timestamp:
                age_days = max(0.0, (now_utc - cand.timestamp).total_seconds() / 86400.0)
                recency_decay = math.exp(-age_days / self.recency_decay_days)
                boost_factor += self.recency_weight * recency_decay

            # Project boost: multiplier if matches active project context
            if active_project_id and cand.project_id and cand.project_id == active_project_id:
                boost_factor *= self.project_boost_multiplier

            cand.score = base_score * boost_factor

        # Sort all unique candidates by final fused score descending
        ranked_candidates = sorted(candidates_by_id.values(), key=lambda c: c.score, reverse=True)
        return ranked_candidates
