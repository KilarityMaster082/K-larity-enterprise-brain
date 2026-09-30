# Owner task: EB-45 Reranker (bge-reranker-v2-m3)
"""Unit and benchmark tests for cross-encoder reranking, batch scoring, latency metrics, and nDCG@10 evaluation."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import pytest
from typing import Any

from compress import EvidenceCandidate
from rerank import (
    CrossEncoderReranker,
    LiteLLMRerankerBackend,
    LocalCrossEncoderBackend,
    RerankedCandidate,
    dcg_at_k,
    ndcg_at_k,
)
from retrieve import RetrievalCandidate


class MockLiteLLMHttpClient:
    """Simulates LiteLLM /v1/rerank endpoint."""

    def __init__(self, latency_sec: float = 0.005) -> None:
        self.latency_sec = latency_sec
        self.calls: list[dict[str, Any]] = []

    async def post(self, url: str, json: dict[str, Any], headers: dict[str, str]) -> Any:
        self.calls.append({"url": url, "json": json, "headers": headers})
        if self.latency_sec > 0:
            await asyncio.sleep(self.latency_sec)

        query = json.get("query", "").lower()
        documents = json.get("documents", [])

        # Assign relevance based on keyword match
        results = []
        for idx, doc in enumerate(documents):
            score = 0.1
            doc_lower = doc.lower()
            if query in doc_lower:
                score = 0.95
            elif any(w in doc_lower for w in query.split() if len(w) > 2):
                score = 0.75
            results.append({"index": idx, "relevance_score": score})

        class MockResponse:
            def json(self_inner) -> dict[str, Any]:
                return {"results": results}

        return MockResponse()


@pytest.fixture
def mock_candidates_50() -> list[RetrievalCandidate]:
    """Generates 50 synthetic fused candidates."""
    candidates = []
    for i in range(1, 51):
        # Insert high relevance documents deeper down in the fused list (ranks 15, 25, 40)
        # to test reranking promotion
        if i == 25:
            text = "Pile foundation concrete grade specification for Tower B requires M35 grade self-compacting concrete as per IS 456."
        elif i == 40:
            text = "Foundation piling details for Tower B: M35 grade concrete with 28-day characteristic strength of 35 N/mm2."
        elif i == 15:
            text = "Structural drawing notes: All foundation piles under Tower B shall use M35 grade concrete."
        else:
            text = f"General site safety guidelines and daily labour attendance log entry #{i} for Tower A and common parking lot."

        candidates.append(
            RetrievalCandidate(
                chunk_id=f"chk_{i:03d}",
                document_id=f"doc_{(i % 10) + 1}",
                text=text,
                score=1.0 / (i + 1),  # Fused RRF score
                channel_ranks={"dense": i, "bm25": i + 5},
                channel_scores={"dense": 0.8 - (i * 0.01), "bm25": 10.0 - (i * 0.1)},
                source_metadata={"section": "piling" if "Pile" in text else "site_ops"},
                timestamp=datetime.now(timezone.utc),
                project_id="prj_tower_b",
            )
        )
    return candidates


def test_reranker_batch_scoring(mock_candidates_50: list[RetrievalCandidate]) -> None:
    """Verifies batch scoring across 50 candidates down to top 10."""
    reranker = CrossEncoderReranker(
        backend=LocalCrossEncoderBackend(),
        default_top_k=10,
        batch_size=16,
    )

    query = "pile foundation concrete grade specification Tower B"
    results, metrics = asyncio.run(reranker.rerank(query, mock_candidates_50, top_k=10))

    # Verify top-K truncation
    assert len(results) == 10
    # Verify batching took ceil(50/16) = 4 batches
    assert metrics.batch_count == 4
    assert metrics.candidate_count == 50
    assert metrics.sla_met is True
    assert metrics.duration_ms < 400.0

    # The high relevance items from initial rank 15, 25, 40 should be promoted into top 3!
    top_chunk_ids = [r.chunk_id for r in results[:3]]
    assert "chk_015" in top_chunk_ids
    assert "chk_025" in top_chunk_ids
    assert "chk_040" in top_chunk_ids

    # Verify metadata preservation and rank assignment
    top_cand = results[0]
    assert top_cand.rerank_rank == 1
    assert top_cand.initial_rank in (15, 25, 40)
    assert top_cand.score > 0.5
    assert top_cand.project_id == "prj_tower_b"

    # Conversion to EvidenceCandidate for EB-46 & EB-47
    ev = top_cand.to_evidence_candidate()
    assert isinstance(ev, EvidenceCandidate)
    assert ev.evidence_id == f"ev_{top_cand.chunk_id}"
    assert ev.metadata["rerank_rank"] == 1
    assert ev.metadata["initial_rank"] == top_cand.initial_rank


def test_litellm_rerank_backend(mock_candidates_50: list[RetrievalCandidate]) -> None:
    """Verifies LiteLLM API proxy integration with model 'rerank'."""
    mock_client = MockLiteLLMHttpClient(latency_sec=0.002)
    backend = LiteLLMRerankerBackend(
        model="rerank",
        api_base="http://test-litellm:4000",
        api_key="sk-test-key",
        http_client=mock_client,
    )
    reranker = CrossEncoderReranker(backend=backend, default_top_k=5, batch_size=20)

    query = "pile foundation concrete grade"
    results, metrics = asyncio.run(reranker.rerank(query, mock_candidates_50[:40]))

    assert len(results) == 5
    assert len(mock_client.calls) == 2  # 40 items / batch size 20 = 2 calls
    assert mock_client.calls[0]["json"]["model"] == "rerank"
    assert metrics.duration_ms < 400.0


def test_min_score_filtering() -> None:
    """Verifies that candidates below min_score threshold are filtered out."""
    candidates = [
        {"chunk_id": "c1", "text": "Relevant concrete slab details", "score": 0.8},
        {"chunk_id": "c2", "text": "Unrelated fruit and vegetable inventory", "score": 0.1},
        {"chunk_id": "c3", "text": "Another unrelated random statement", "score": 0.05},
    ]
    reranker = CrossEncoderReranker(min_score=0.4)
    results, _ = asyncio.run(reranker.rerank("concrete slab specifications", candidates))

    assert len(results) == 1
    assert results[0].chunk_id == "c1"


def test_dcg_and_ndcg_at_k() -> None:
    """Tests DCG and nDCG calculation accuracy."""
    # Ideal order: rel scores 3, 2, 1
    ground_truth = {"c1": 3.0, "c2": 2.0, "c3": 1.0}
    perfect_ranking = ["c1", "c2", "c3"]
    imperfect_ranking = ["c3", "c2", "c1"]

    ndcg_perfect = ndcg_at_k(perfect_ranking, ground_truth, k=3)
    assert ndcg_perfect == 1.0

    ndcg_imperfect = ndcg_at_k(imperfect_ranking, ground_truth, k=3)
    assert 0.0 < ndcg_imperfect < 1.0


def test_golden_set_ndcg_improvement() -> None:
    """Golden Set Evaluation: Cross-encoder reranking improves nDCG@10 over fused RRF baseline."""
    # Golden queries with known ground truth chunk relevance (0 to 3)
    golden_benchmark = [
        {
            "query": "curing period for RCC slab IS 456",
            "ground_truth": {"chk_cur_1": 3.0, "chk_cur_2": 2.0, "chk_cur_3": 1.0},
            # Baseline RRF list where relevant docs were buried by lexical noise
            "fused_list": [
                RetrievalCandidate(chunk_id="chk_noise_1", document_id="d1", text="Daily labor attendance on site", score=0.5),
                RetrievalCandidate(chunk_id="chk_noise_2", document_id="d1", text="Invoice for steel rebars", score=0.48),
                RetrievalCandidate(chunk_id="chk_cur_3", document_id="d2", text="Curing compound application method", score=0.45),
                RetrievalCandidate(chunk_id="chk_noise_3", document_id="d1", text="Site gate entry log", score=0.42),
                RetrievalCandidate(chunk_id="chk_cur_2", document_id="d2", text="Water curing requirements for OPC concrete", score=0.40),
                RetrievalCandidate(chunk_id="chk_noise_4", document_id="d1", text="Monthly safety meeting minutes", score=0.38),
                RetrievalCandidate(chunk_id="chk_cur_1", document_id="d2", text="Minimum curing period for RCC slab shall be 7 days for OPC and 10 days for mineral admixtures as per IS 456.", score=0.35),
            ],
        },
        {
            "query": "fire pump flow capacity requirement NBC",
            "ground_truth": {"chk_fp_1": 3.0, "chk_fp_2": 2.0},
            "fused_list": [
                RetrievalCandidate(chunk_id="chk_noise_a", document_id="d3", text="Pumping water from basement excavation", score=0.55),
                RetrievalCandidate(chunk_id="chk_fp_2", document_id="d4", text="Fire fighting hydrants installation notes", score=0.50),
                RetrievalCandidate(chunk_id="chk_noise_b", document_id="d3", text="Diesel generator fuel tank capacity", score=0.45),
                RetrievalCandidate(chunk_id="chk_fp_1", document_id="d4", text="Main fire pump capacity must deliver 2850 LPM at 7 bar head conforming to NBC Part 4.", score=0.40),
            ],
        },
    ]

    reranker = CrossEncoderReranker(backend=LocalCrossEncoderBackend())

    fused_ndcgs = []
    reranked_ndcgs = []

    for item in golden_benchmark:
        query = item["query"]
        gt = item["ground_truth"]
        fused_cands = item["fused_list"]

        # Baseline nDCG@10
        fused_ids = [c.chunk_id for c in fused_cands]
        fused_ndcg = ndcg_at_k(fused_ids, gt, k=10)
        fused_ndcgs.append(fused_ndcg)

        # Reranked nDCG@10
        reranked_cands, metrics = asyncio.run(reranker.rerank(query, fused_cands, top_k=10))
        reranked_ids = [c.chunk_id for c in reranked_cands]
        reranked_ndcg = ndcg_at_k(reranked_ids, gt, k=10)
        reranked_ndcgs.append(reranked_ndcg)

        # Assert per-query SLA
        assert metrics.sla_met is True
        assert metrics.duration_ms < 400.0

    avg_fused_ndcg = sum(fused_ndcgs) / len(fused_ndcgs)
    avg_reranked_ndcg = sum(reranked_ndcgs) / len(reranked_ndcgs)

    # Acceptance criteria verification:
    # 1. Reranking improves nDCG@10 over fused list on golden set
    assert avg_reranked_ndcg > avg_fused_ndcg
    assert avg_reranked_ndcg >= 0.85
    # 2. P95 latency is under 400 ms SLA
    assert reranker.p95_latency_ms < 400.0
