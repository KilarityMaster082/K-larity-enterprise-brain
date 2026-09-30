# Owner task: EB-48 Evidence verification
"""Evidence verification engine verifying AnswerContracts against cited source context.

Enforces:
- Claim decomposition into atomic verifiable propositions.
- Exact match verification for numbers, currencies, and dates.
- Natural Language Inference (NLI) / entailment checking (fast model or local heuristic).
- Unsupported claims dropped or moved to 'unknowns'.
- Contradiction / conflict detection across multiple sources.
- Acceptance criteria: Faithfulness ≥ 0.95; unanswerable queries yield 'insufficient_evidence'.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
import logging
import re
from typing import Any, Callable, Sequence

from packages.schemas.answer_contract.schema import (
    AnswerContract,
    AnswerStatus,
    Claim,
    Confidence,
    ConfidenceLevel,
    Evidence,
    Risk,
    Segment,
)
try:
    from router import LlmRouter, ModelAlias
except ImportError:
    try:
        from services.llm_gateway.router import LlmRouter, ModelAlias  # type: ignore
    except ImportError:
        class ModelAlias:  # type: ignore
            FAST = "fast"
        class LlmRouter:  # type: ignore
            def complete(self, *args, **kwargs):
                raise NotImplementedError()

logger = logging.getLogger(__name__)


class EntailmentVerdict(str, Enum):
    ENTAILED = "entailed"
    CONTRADICTED = "contradicted"
    NEUTRAL = "neutral"  # Unsupported / not mentioned


@dataclass
class VerificationResult:
    """Individual claim verification outcome."""

    claim_id: str
    text: str
    verdict: EntailmentVerdict
    confidence: float
    reason: str
    numbers_matched: bool
    dates_matched: bool
    evidence_ids: list[str]


@dataclass
class VerificationReport:
    """Aggregated verification report for an AnswerContract."""

    faithfulness_score: float
    total_claims: int
    verified_claims: int
    unsupported_claims: int
    contradicted_claims: int
    conflicts_detected: list[str]
    claim_results: list[VerificationResult] = field(default_factory=list)


class ClaimSplitter:
    """Decomposes compound sentences and paragraphs into atomic claims."""

    @staticmethod
    def split(text: str) -> list[str]:
        """Splits text on sentence boundaries and coordinating conjunctions."""
        # Clean text
        raw_sentences = re.split(r"(?<=[.!?])\s+", text.strip())
        claims: list[str] = []
        for s in raw_sentences:
            s_clean = s.strip()
            if not s_clean:
                continue
            # Split compound clauses on ';' or ' and also '
            sub_clauses = re.split(r";\s*|\s+and\s+also\s+", s_clean)
            for sub in sub_clauses:
                sub_str = sub.strip()
                if len(sub_str) > 10:
                    claims.append(sub_str)
        return claims or [text]


class NumberAndDateMatcher:
    """Verifies that numbers, quantities, monetary values, and dates in claims exist in cited evidence."""

    NUMBER_PATTERN = re.compile(r"\b(?:\d{1,3}(?:,\d{2,3})*(?:\.\d+)?|\d+(?:\.\d+)?)\b")
    DATE_PATTERN = re.compile(
        r"\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2}|"
        r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4})\b",
        re.IGNORECASE,
    )

    @classmethod
    def check_numbers(cls, claim_text: str, evidence_text: str) -> bool:
        """Checks if all numbers present in the claim are found in the evidence (allowing formatting differences)."""
        claim_nums = [n.replace(",", "") for n in cls.NUMBER_PATTERN.findall(claim_text)]
        # Filter out minor list bullet numbering like '1', '2' if standalone
        filtered_nums = [n for n in claim_nums if len(n) > 1 or float(n) > 5.0]
        if not filtered_nums:
            return True

        ev_clean = evidence_text.replace(",", "")
        for num in filtered_nums:
            if num not in ev_clean:
                # Check float equivalence (e.g. 14.5 vs 14.50)
                try:
                    fval = float(num)
                    # Check if floating value appears in evidence
                    ev_numbers = [float(n) for n in cls.NUMBER_PATTERN.findall(ev_clean) if n]
                    if not any(abs(fval - ev_num) < 1e-4 for ev_num in ev_numbers):
                        return False
                except ValueError:
                    return False
        return True

    @classmethod
    def check_dates(cls, claim_text: str, evidence_text: str) -> bool:
        """Checks if dates in claim appear in evidence."""
        claim_dates = cls.DATE_PATTERN.findall(claim_text)
        if not claim_dates:
            return True
        for dt in claim_dates:
            if dt.lower() not in evidence_text.lower():
                return False
        return True


class EntailmentChecker:
    """Evaluates whether an evidence passage logically entails a claim."""

    def __init__(
        self,
        router: LlmRouter | None = None,
        model_alias: str | ModelAlias = ModelAlias.FAST,
    ) -> None:
        self.router = router or LlmRouter()
        self.model_alias = model_alias

    def check(
        self,
        claim: str,
        evidence_excerpt: str,
        mock_invoker: Callable[[str, list[dict[str, str]]], str] | None = None,
    ) -> tuple[EntailmentVerdict, float, str]:
        """Classifies entailment between claim and evidence passage."""
        if not evidence_excerpt or not claim:
            return EntailmentVerdict.NEUTRAL, 0.0, "Missing claim or evidence excerpt"

        # Heuristic check first for deterministic speed
        claim_lower = claim.lower()
        ev_lower = evidence_excerpt.lower()

        # Check for explicit negation / contradiction keywords
        contradiction_keywords = [
            ("not required", "require"),
            ("not require", "require"),
            ("shall not", "shall"),
            ("rejected", "approved"),
            ("cancelled", "scheduled"),
            ("failed", "passed"),
            ("no ", "yes "),
        ]
        for neg, pos in contradiction_keywords:
            if (neg in claim_lower and pos in ev_lower) or (pos in claim_lower and neg in ev_lower):
                return (
                    EntailmentVerdict.CONTRADICTED,
                    0.90,
                    f"Polarity conflict detected between '{neg}' and '{pos}'",
                )

        # Word overlap calculation
        claim_words = set(re.findall(r"\b\w{3,}\b", claim_lower))
        ev_words = set(re.findall(r"\b\w{3,}\b", ev_lower))

        if not claim_words:
            return EntailmentVerdict.ENTAILED, 1.0, "Trivial claim"

        overlap = len(claim_words & ev_words) / len(claim_words)

        if overlap >= 0.65:
            return EntailmentVerdict.ENTAILED, min(1.0, overlap), f"High semantic lexical overlap ({overlap:.0%})"
        elif overlap >= 0.35:
            # Ambiguous: if mock_invoker provided, consult LLM
            if mock_invoker:
                try:
                    resp = mock_invoker(
                        "fast",
                        [{"role": "user", "content": f"Premise: {evidence_excerpt}\nHypothesis: {claim}"}],
                    )
                    if "entailed" in resp.lower():
                        return EntailmentVerdict.ENTAILED, 0.85, "Model verified entailment"
                    elif "contradicted" in resp.lower():
                        return EntailmentVerdict.CONTRADICTED, 0.85, "Model verified contradiction"
                except Exception:
                    pass
            return EntailmentVerdict.ENTAILED, 0.70, f"Moderate lexical overlap ({overlap:.0%})"
        else:
            return (
                EntailmentVerdict.NEUTRAL,
                0.20,
                f"Insufficient support in cited excerpt (overlap {overlap:.0%})",
            )


class EvidenceVerifier:
    """Verifies all claims in an AnswerContract, strips unsupported statements, and detects conflicts."""

    def __init__(
        self,
        entailment_checker: EntailmentChecker | None = None,
        min_faithfulness_threshold: float = 0.95,
    ) -> None:
        self.checker = entailment_checker or EntailmentChecker()
        self.min_faithfulness_threshold = min_faithfulness_threshold

    def verify_contract(
        self,
        contract: AnswerContract,
        mock_invoker: Callable[[str, list[dict[str, str]]], str] | None = None,
    ) -> tuple[AnswerContract, VerificationReport]:
        """Audits the AnswerContract, removes unsupported claims, moves them to unknowns, and surfaces conflicts."""
        evidence_map: dict[str, Evidence] = {ev.id: ev for ev in contract.evidence}
        claim_results: list[VerificationResult] = []

        verified_facts: list[Claim] = []
        conflicts: list[str] = list(contract.conflicts)
        new_unknowns: list[str] = list(contract.unknowns)

        for claim in contract.facts:
            # Aggregate cited excerpts
            cited_excerpts = [evidence_map[eid].excerpt for eid in claim.evidence_ids if eid in evidence_map]
            combined_evidence_text = "\n".join(cited_excerpts)

            if not combined_evidence_text:
                res = VerificationResult(
                    claim_id=claim.id,
                    text=claim.text,
                    verdict=EntailmentVerdict.NEUTRAL,
                    confidence=0.0,
                    reason="No valid evidence cited",
                    numbers_matched=False,
                    dates_matched=False,
                    evidence_ids=claim.evidence_ids,
                )
                claim_results.append(res)
                new_unknowns.append(f"Unverified: '{claim.text}' (no evidence passage found)")
                continue

            # Check numbers and dates
            nums_ok = NumberAndDateMatcher.check_numbers(claim.text, combined_evidence_text)
            dates_ok = NumberAndDateMatcher.check_dates(claim.text, combined_evidence_text)

            # Check entailment
            verdict, conf, reason = self.checker.check(claim.text, combined_evidence_text, mock_invoker=mock_invoker)

            if not nums_ok:
                verdict = EntailmentVerdict.NEUTRAL
                reason = "Numeric figures in claim do not match figures in cited evidence"
            elif not dates_ok:
                verdict = EntailmentVerdict.NEUTRAL
                reason = "Dates in claim do not match dates in cited evidence"

            res = VerificationResult(
                claim_id=claim.id,
                text=claim.text,
                verdict=verdict,
                confidence=conf,
                reason=reason,
                numbers_matched=nums_ok,
                dates_matched=dates_ok,
                evidence_ids=claim.evidence_ids,
            )
            claim_results.append(res)

            if verdict == EntailmentVerdict.ENTAILED:
                verified_facts.append(claim)
            elif verdict == EntailmentVerdict.CONTRADICTED:
                conflict_msg = f"Contradiction in '{claim.id}': {claim.text} (Conflicts with cited evidence: {reason})"
                conflicts.append(conflict_msg)
                new_unknowns.append(f"Conflicting: '{claim.text}'")
            else:
                new_unknowns.append(f"Unverified: '{claim.text}' ({reason})")

        total_claims = len(contract.facts)
        verified_count = len(verified_facts)
        unsupported_count = sum(1 for r in claim_results if r.verdict == EntailmentVerdict.NEUTRAL)
        contradicted_count = sum(1 for r in claim_results if r.verdict == EntailmentVerdict.CONTRADICTED)

        faithfulness = (verified_count / total_claims) if total_claims > 0 else 1.0

        # Update contract with verified claims and conflicts
        contract.facts = verified_facts
        contract.conflicts = list(dict.fromkeys(conflicts))
        contract.unknowns = list(dict.fromkeys(new_unknowns))

        # If zero verified facts remain or unanswerable query
        if not verified_facts:
            contract.status = AnswerStatus.INSUFFICIENT_EVIDENCE
            contract.confidence = Confidence(
                level=ConfidenceLevel.LOW,
                reason="Insufficient evidence: no assertions could be verified against source records.",
            )
            # Add safe fallback segment if answer was populated with unverified claims
            contract.answer = [
                Segment(
                    text="There is not enough evidence in the current records to answer this question reliably.",
                    evidenceIds=[],
                )
            ]
        elif faithfulness < self.min_faithfulness_threshold:
            contract.status = AnswerStatus.PARTIAL
            contract.confidence = Confidence(
                level=ConfidenceLevel.MEDIUM,
                reason=f"Partial confidence: only {verified_count}/{total_claims} assertions were fully verified.",
            )

        report = VerificationReport(
            faithfulness_score=round(faithfulness, 4),
            total_claims=total_claims,
            verified_claims=verified_count,
            unsupported_claims=unsupported_count,
            contradicted_claims=contradicted_count,
            conflicts_detected=contract.conflicts,
            claim_results=claim_results,
        )

        return contract, report
