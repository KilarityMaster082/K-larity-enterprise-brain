# Owner task: EB-48 Evidence verification
"""Unit and benchmark tests for evidence verification, claim splitting, number/date matching, conflict detection, and faithfulness threshold."""

from __future__ import annotations

import pytest

from packages.schemas.answer_contract.schema import (
    AnswerContract,
    AnswerStatus,
    Claim,
    Confidence,
    ConfidenceLevel,
    Evidence,
    Figure,
    Segment,
    SourceType,
)
from verify import (
    ClaimSplitter,
    EntailmentChecker,
    EntailmentVerdict,
    EvidenceVerifier,
    NumberAndDateMatcher,
)


def test_claim_splitter() -> None:
    """Subtask 1: Tests splitting compound statements into atomic verifiable claims."""
    compound_text = (
        "The pile cap concrete grade is M35 as per IS 456. "
        "The contractor completed 42 piles yesterday and also submitted invoice #104 for payment."
    )
    claims = ClaimSplitter.split(compound_text)
    assert len(claims) >= 2
    assert any("M35" in c for c in claims)
    assert any("42 piles" in c for c in claims)


def test_exact_match_for_numbers_and_dates() -> None:
    """Subtask 3: Tests exact match verification for numbers, currencies, and dates."""
    evidence_text = (
        "On 15/10/2026, certified billing amount of INR 14,500,000 was approved for Tower B foundation works."
    )

    # Valid matches (with and without commas)
    assert NumberAndDateMatcher.check_numbers("Spend is 14500000 INR", evidence_text) is True
    assert NumberAndDateMatcher.check_numbers("Spend is 14,500,000 INR", evidence_text) is True
    assert NumberAndDateMatcher.check_dates("Approved on 15/10/2026", evidence_text) is True

    # Hallucinated number (claim says 25,000,000)
    assert NumberAndDateMatcher.check_numbers("Spend is 25,000,000 INR", evidence_text) is False

    # Hallucinated date (claim says 20/12/2026)
    assert NumberAndDateMatcher.check_dates("Approved on 20/12/2026", evidence_text) is False


def test_entailment_checker() -> None:
    """Subtask 2: Tests entailment and contradiction detection."""
    checker = EntailmentChecker()
    evidence_passage = "All structural columns in Basement 1 require M40 grade concrete."

    # Entailed
    verdict, conf, _ = checker.check(
        "Basement 1 structural columns require M40 concrete.",
        evidence_passage,
    )
    assert verdict == EntailmentVerdict.ENTAILED
    assert conf >= 0.65

    # Unsupported / Neutral
    verdict_neutral, _, _ = checker.check(
        "Basement 1 structural columns are scheduled for painting next week.",
        evidence_passage,
    )
    assert verdict_neutral == EntailmentVerdict.NEUTRAL

    # Contradiction
    verdict_contra, _, _ = checker.check(
        "M40 grade concrete is not required for Basement 1 columns.",
        evidence_passage,
    )
    assert verdict_contra == EntailmentVerdict.CONTRADICTED


def test_conflict_detection_and_surface() -> None:
    """Subtask 4: Surfaces contradictions between claims and source evidence into conflicts."""
    ev = Evidence(
        id="ev_01",
        sourceType=SourceType.DOCUMENT,
        title="Site Inspection Report",
        excerpt="The concrete cube test failed 28-day compressive strength requirements.",
    )

    contract = AnswerContract(
        question="Did the concrete pass compressive tests?",
        status=AnswerStatus.ANSWERED,
        answer=[Segment(text="The concrete passed compressive tests.", evidenceIds=["ev_01"])],
        facts=[
            Claim(
                id="fact_passed",
                text="The concrete cube test passed 28-day strength tests.",
                evidenceIds=["ev_01"],
            )
        ],
        confidence=Confidence(level=ConfidenceLevel.HIGH, reason="Test"),
        evidence=[ev],
    )

    verifier = EvidenceVerifier()
    verified_contract, report = verifier.verify_contract(contract)

    assert report.contradicted_claims == 1
    assert len(verified_contract.conflicts) > 0
    assert "Polarity conflict" in verified_contract.conflicts[0] or "Conflicts" in verified_contract.conflicts[0]
    assert verified_contract.status == AnswerStatus.INSUFFICIENT_EVIDENCE


def test_unanswerable_questions_say_not_enough_evidence() -> None:
    """Subtask 5 & Acceptance criteria: unanswerable questions yield 'insufficient_evidence'."""
    ev = Evidence(
        id="ev_weather",
        sourceType=SourceType.DOCUMENT,
        title="Site Weather Report",
        excerpt="Clear skies and sunny weather recorded across the site all week.",
    )

    # Question about piling cost where only weather evidence exists
    contract = AnswerContract(
        question="What was the total expenditure on piling rigs?",
        status=AnswerStatus.ANSWERED,
        answer=[Segment(text="Piling rig expenditure was 50 Lakhs.", evidenceIds=["ev_weather"])],
        facts=[
            Claim(
                id="fact_spend",
                text="Total expenditure on piling rigs was 50,00,000 INR.",
                evidenceIds=["ev_weather"],
            )
        ],
        confidence=Confidence(level=ConfidenceLevel.HIGH, reason="Weather report"),
        evidence=[ev],
    )

    verifier = EvidenceVerifier()
    verified_contract, report = verifier.verify_contract(contract)

    # Acceptance criteria verification:
    # 1. Fact was rejected due to lack of support/figures in weather report
    assert report.verified_claims == 0
    assert report.unsupported_claims == 1
    # 2. Status set to insufficient_evidence
    assert verified_contract.status == AnswerStatus.INSUFFICIENT_EVIDENCE
    # 3. Answer segment updated to say "not enough evidence"
    assert "not enough evidence" in verified_contract.answer[0].text.lower()
    assert any("Unverified" in u for u in verified_contract.unknowns)


def test_golden_set_faithfulness_above_95_percent() -> None:
    """Acceptance criteria: Faithfulness ≥ 0.95 on golden verified set."""
    ev1 = Evidence(
        id="ev_01",
        sourceType=SourceType.DOCUMENT,
        title="IS 456 Extract",
        excerpt="Minimum cement content for reinforced concrete under severe exposure is 320 kg/m3.",
    )
    ev2 = Evidence(
        id="ev_02",
        sourceType=SourceType.SQL,
        title="Certified Billing Query",
        excerpt="Metric: Certified Steel Payout = 8500000.0 INR",
    )

    contract = AnswerContract(
        question="What is the cement content and certified steel payout?",
        status=AnswerStatus.ANSWERED,
        answer=[
            Segment(text="Minimum cement content is 320 kg/m3.", evidenceIds=["ev_01"]),
            Segment(text="Certified steel payout is 8,500,000.00 INR.", evidenceIds=["ev_02"]),
        ],
        facts=[
            Claim(
                id="fact_cement",
                text="Minimum cement content for reinforced concrete under severe exposure is 320 kg/m3.",
                evidenceIds=["ev_01"],
            ),
            Claim(
                id="fact_steel",
                text="Certified steel payout is 8,500,000.00 INR.",
                evidenceIds=["ev_02"],
                figure=Figure(amount=8500000.0, origin="sql"),
            ),
        ],
        confidence=Confidence(level=ConfidenceLevel.HIGH, reason="Audited sources"),
        evidence=[ev1, ev2],
    )

    verifier = EvidenceVerifier()
    verified_contract, report = verifier.verify_contract(contract)

    assert report.faithfulness_score >= 0.95
    assert report.verified_claims == 2
    assert report.unsupported_claims == 0
    assert verified_contract.status == AnswerStatus.ANSWERED
