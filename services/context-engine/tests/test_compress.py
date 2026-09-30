# Owner task: EB-46 Context compression and caching
"""Unit and integration tests for context compression, near-duplicate removal, evidence ID preservation, and answer caching."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import pytest

from compress import (
    AnswerCache,
    CompressedContext,
    ContextCompressor,
    EvidenceCandidate,
    NearDuplicateFilter,
    QueryIntent,
    compute_cache_key,
    evaluate_faithfulness_retention,
    normalize_query_for_cache,
    strip_forward_headers,
)


def test_token_budget_per_intent() -> None:
    compressor = ContextCompressor()

    assert compressor.get_budget(QueryIntent.FACTOID) == 1500
    assert compressor.get_budget(QueryIntent.LOOKUP) == 2000
    assert compressor.get_budget(QueryIntent.SUMMARY) == 3500
    assert compressor.get_budget(QueryIntent.COMPARISON) == 5000
    assert compressor.get_budget(QueryIntent.ANALYSIS) == 6500
    assert compressor.get_budget(QueryIntent.DEEP_REASONING) == 8000
    assert compressor.get_budget("unknown_intent") == 4000


def test_near_duplicate_removal_forwarded_messages() -> None:
    filter_dup = NearDuplicateFilter(similarity_threshold=0.80)

    # 1. Primary email message
    c1 = EvidenceCandidate(
        evidence_id="ev_001",
        text="HVAC quotation for Studio 8 Villa project is ₹45,50,000 including Daikin VRV units and installation.",
        document_id="doc_email_1",
        chunk_id="chk_001",
        score=0.95,
    )

    # 2. Forwarded copy of the same message with Fwd header
    c2 = EvidenceCandidate(
        evidence_id="ev_002",
        text="---------- Forwarded message ---------\nFrom: Estimator\nFwd: HVAC quotation for Studio 8 Villa project is ₹45,50,000 including Daikin VRV units and installation.",
        document_id="doc_email_2",
        chunk_id="chk_002",
        score=0.88,
    )

    # 3. Another copy forwarded on WhatsApp
    c3 = EvidenceCandidate(
        evidence_id="ev_003",
        text="[25/09/2026, 11:00] Sanjay: Fwd: HVAC quotation for Studio 8 Villa project is ₹45,50,000 including Daikin VRV units and installation.",
        document_id="doc_wa_1",
        chunk_id="chk_003",
        score=0.80,
    )

    # 4. Distinct message about electrical work
    c4 = EvidenceCandidate(
        evidence_id="ev_004",
        text="Electrical cabling BOQ is ₹12,30,000 with Finolex wires and Schneider switchgear.",
        document_id="doc_email_3",
        chunk_id="chk_004",
        score=0.92,
    )

    unique_cands, removed_count = filter_dup.filter([c1, c2, c3, c4])

    # Out of 4 candidates, 2 duplicate forwarded messages are removed
    assert removed_count == 2
    assert len(unique_cands) == 2
    assert unique_cands[0].evidence_id == "ev_001"
    assert unique_cands[1].evidence_id == "ev_004"


def test_preserve_evidence_ids_through_compression() -> None:
    compressor = ContextCompressor()

    c1 = EvidenceCandidate(
        evidence_id="ev_boq_42",
        text="Item 4.2: Reinforcement steel Fe 500D - 14.5 MT @ ₹68,000/MT = ₹9,86,000.",
        document_id="doc_boq_rev3",
        chunk_id="chunk_table_row_4",
        score=0.98,
    )
    c2 = EvidenceCandidate(
        evidence_id="ev_quotation_18",
        text="Vendor quotation Q-882: Ready-mix concrete M30 grade - 120 cum @ ₹5,200/cum = ₹6,24,000.",
        document_id="doc_vendor_q",
        chunk_id="chunk_table_row_12",
        score=0.91,
    )

    compressed = compressor.compress(
        query="What is the cost of steel and concrete?",
        candidates=[c1, c2],
        intent=QueryIntent.FACTOID,
    )

    # Check evidence ID tags in prompt context
    assert 'evidence id="ev_boq_42"' in compressed.prompt_context
    assert 'doc="doc_boq_rev3"' in compressed.prompt_context
    assert 'chunk="chunk_table_row_4"' in compressed.prompt_context
    assert 'evidence id="ev_quotation_18"' in compressed.prompt_context
    assert 'doc="doc_vendor_q"' in compressed.prompt_context
    assert 'chunk="chunk_table_row_12"' in compressed.prompt_context

    # All evidence objects retained with exact IDs intact
    assert len(compressed.selected_evidence) == 2
    assert [e.evidence_id for e in compressed.selected_evidence] == ["ev_boq_42", "ev_quotation_18"]


def test_context_budget_enforcement() -> None:
    compressor = ContextCompressor()

    # Generate 40 distinct evidence candidates of ~100 tokens each to exercise budget limits
    candidates = [
        EvidenceCandidate(
            evidence_id=f"ev_{i}",
            text=f"Progress report week {i}: Detailed structural analysis for tower block {i}. "
                 f"Excavation, shuttering, concrete pouring and MEP ducting executed according to schedule. "
                 f"Labour deployment was 85 masons and 120 helpers. Total expenditure for phase was ₹{i*100000}. "
                 f"Material testing cube strength test passed at 32.5 N/mm2. Quality assurance signoff completed.",
            document_id=f"doc_{i}",
            chunk_id=f"chk_{i}",
            score=1.0 - (i * 0.02),
        )
        for i in range(40)
    ]

    # Compress under strict FACTOID budget (1500 tokens)
    compressed_factoid = compressor.compress(
        query="Latest block progress",
        candidates=candidates,
        intent=QueryIntent.FACTOID,
    )
    assert compressed_factoid.total_tokens <= 1500
    assert compressed_factoid.intent == QueryIntent.FACTOID

    # Compress under SUMMARY budget (3500 tokens)
    compressed_summary = compressor.compress(
        query="Summarize overall project progress",
        candidates=candidates,
        intent=QueryIntent.SUMMARY,
    )
    assert compressed_summary.total_tokens <= 3500
    assert len(compressed_summary.selected_evidence) > len(compressed_factoid.selected_evidence)


def test_faithfulness_retention_evaluation() -> None:
    compressor = ContextCompressor()

    c1 = EvidenceCandidate(
        evidence_id="ev_audit_1",
        text="On 25/09/2026, GSTIN 29AABCU9603R1Z7 invoice was approved for ₹18,40,500 by Sanjay Kilari.",
        document_id="doc_invoice_99",
        chunk_id="chk_01",
        score=0.99,
    )

    compressed = compressor.compress(
        query="Verify invoice approval",
        candidates=[c1],
        intent=QueryIntent.FACTOID,
    )

    retention_score = evaluate_faithfulness_retention([c1], compressed)
    # Critical facts (dates, GSTIN, amount, name) must be 100% retained
    assert retention_score == 1.0


def test_answer_cache_tenant_isolation_and_invalidation() -> None:
    cache = AnswerCache(default_ttl_seconds=3600)

    tenant_a = "tenant-studio8"
    tenant_b = "tenant-prestige"
    scope_admin = "role:admin,proj:p1"
    scope_staff = "role:staff,proj:p1"
    query = "What is the HVAC BOQ total?"
    data_v1 = "v1.0.0"
    data_v2 = "v1.0.1"

    answer_text = "The HVAC BOQ total is ₹45,50,000 according to Rev 2."
    evidence_ids = ["ev_boq_rev2"]

    # 1. Cache miss initially
    assert cache.get(tenant_a, scope_admin, query, data_v1) is None

    # 2. Store answer in cache
    cache.set(tenant_a, scope_admin, query, data_v1, answer_text, evidence_ids)

    # 3. Cache hit for exact match (with whitespace/punctuation normalization)
    hit = cache.get(tenant_a, scope_admin, "what is the hvac boq total??", data_v1)
    assert hit is not None
    assert hit.answer_text == answer_text
    assert hit.evidence_ids == evidence_ids

    # 4. Cache miss for different permission scope
    assert cache.get(tenant_a, scope_staff, query, data_v1) is None

    # 5. Cache miss for different tenant
    assert cache.get(tenant_b, scope_admin, query, data_v1) is None

    # 6. Cache miss when data_version bumps (data sync occurred)
    assert cache.get(tenant_a, scope_admin, query, data_v2) is None

    # 7. Invalidate tenant
    cache.set(tenant_a, scope_admin, query, data_v2, answer_text, evidence_ids)
    assert cache.get(tenant_a, scope_admin, query, data_v2) is not None
    cache.invalidate_tenant(tenant_a)
    assert cache.get(tenant_a, scope_admin, query, data_v2) is None
