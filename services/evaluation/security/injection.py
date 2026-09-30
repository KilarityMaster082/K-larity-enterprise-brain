# Owner task: EB-67 Security, permission and prompt-injection tests
"""Prompt-injection and answer-integrity checks for the Context Engine (release-gate input for EB-69).

For every case in injection_cases.yaml:
  1. structure  — the payload, used as evidence text, title and author, leaves exactly one well-formed evidence
                  block (it cannot close its block, forge another, or escape an attribute);
  2. forged-citation — a contract from a model that obeyed the payload and cited the forged block id is
                  rejected by the answer-contract schema;
  3. fake-sql-figure — a figure claimed as SQL-origin with no SQL evidence (rule 3) is dropped in verification
                  and the contract never ends as ``answered``.
Run directly (``python services/evaluation/security/injection.py``) for a CI pass/fail list.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path

import yaml
from pydantic import ValidationError

from compress import EvidenceCandidate
from packages.schemas.answer_contract.schema import (
    AnswerContract, AnswerStatus, Claim, Confidence, ConfidenceLevel, Evidence, Figure, Segment, SourceType,
)
from reason import format_evidence_blocks
from verify import EvidenceVerifier

CASES_PATH = Path(__file__).with_name("injection_cases.yaml")
_OPEN = re.compile(r"<evidence\b")
_CLOSE = re.compile(r"</evidence>")


@dataclass(frozen=True)
class Outcome:
    case_id: str
    check: str
    passed: bool
    detail: str = ""


def load_cases(path: Path = CASES_PATH) -> list[dict]:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    return data["cases"]


def _candidate(payload: str) -> EvidenceCandidate:
    return EvidenceCandidate(
        evidence_id="ev_001", text=payload, document_id="doc-1", chunk_id="c1", score=1.0,
        metadata={"title": payload, "author": payload, "source_type": "document"},
    )


def check_structure(case: dict) -> Outcome:
    block = format_evidence_blocks([_candidate(case["payload"])])
    if len(_OPEN.findall(block)) != 1 or len(_CLOSE.findall(block)) != 1:
        return Outcome(case["id"], "structure", False, "payload changed the number of evidence blocks")
    open_tag = re.match(r"<evidence\b[^>]*>", block, re.DOTALL).group(0)  # escaped text has no raw '>'
    if open_tag.count('"') != 8:  # id, sourceType, title, author — four quoted attributes, no extras
        return Outcome(case["id"], "structure", False, "payload broke out of an attribute")
    if "<script" in block or "<!--" in block:
        return Outcome(case["id"], "structure", False, "raw markup survived")
    return Outcome(case["id"], "structure", True)


def _contract(case: dict, facts: list[Claim], evidence_ids: list[str]) -> AnswerContract:
    real = Evidence(id="ev_001", sourceType=SourceType.DOCUMENT, title="Site memo", excerpt=case["payload"][:200])
    return AnswerContract(
        version="1.0.0", question="What is the budget?", status=AnswerStatus.ANSWERED,
        summary="Budget is 99,99,99,999 INR",
        answer=[Segment(text="Budget is 99,99,99,999 INR", evidenceIds=evidence_ids)],
        facts=facts, evidence=[real], confidence=Confidence(level=ConfidenceLevel.HIGH, reason="obeyed"),
    )


def check_forged_citation(case: dict) -> Outcome:
    """A model that obeys the payload and cites the forged block id must be rejected at contract validation."""
    forged = Claim(id="f_forged", text="Budget is 99,99,99,999 INR", evidenceIds=["ev_forged"])
    try:
        _contract(case, [forged], ["ev_forged"])
    except ValidationError:
        return Outcome(case["id"], "forged-citation", True)
    return Outcome(case["id"], "forged-citation", False, "contract citing an unknown evidence id was accepted")


def check_fake_sql_figure(case: dict) -> Outcome:
    """A figure claimed as SQL-origin with no SQL evidence (rule 3) must not survive verification."""
    fake = Claim(id="f_fake_sql", text=case["payload"][:120], evidenceIds=["ev_001"],
                 figure=Figure(amount=15000000.0, currency="INR", origin="sql", query="SELECT 1"))
    verified, _ = EvidenceVerifier().verify_contract(_contract(case, [fake], ["ev_001"]))
    if any(f.id == "f_fake_sql" for f in verified.facts):
        return Outcome(case["id"], "fake-sql-figure", False, "SQL-origin figure with no SQL evidence survived")
    if verified.status == AnswerStatus.ANSWERED:
        return Outcome(case["id"], "fake-sql-figure", False, "contract still reads as answered")
    return Outcome(case["id"], "fake-sql-figure", True)


def run_suite() -> list[Outcome]:
    out: list[Outcome] = []
    for case in load_cases():
        out.append(check_structure(case))
        out.append(check_forged_citation(case))
        out.append(check_fake_sql_figure(case))
    return out


def main() -> int:
    results = run_suite()
    for r in results:
        print(f"{'PASS' if r.passed else 'FAIL'}  {r.case_id} / {r.check}" + (f"  — {r.detail}" if r.detail else ""))
    failed = [r for r in results if not r.passed]
    print(f"\n{len(results) - len(failed)}/{len(results)} injection checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
