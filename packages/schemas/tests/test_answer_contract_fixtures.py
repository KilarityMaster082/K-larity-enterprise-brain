# Owner task: EB-95 Answer contract types generated from the schema
"""The TypeScript contract (apps/web/lib/contracts.ts) must stay inside the canonical pydantic schema (EB-47).

apps/web/tests/contract-fixtures.test.ts writes the contracts the web app produces to answer_contract/fixtures;
every one must validate here, keep its citations through a round trip, and the committed JSON Schema must match
the model so a schema change is always a reviewed change.
"""

from __future__ import annotations

import json
from pathlib import Path
import re

import pytest

from packages.schemas.answer_contract import SCHEMA_VERSION, AnswerContract, AnswerStatus

HERE = Path(__file__).resolve().parents[1] / "answer_contract"
FIXTURES = sorted((HERE / "fixtures").glob("*.json"))
REPO = Path(__file__).resolve().parents[3]


def test_fixtures_exist() -> None:
    assert len(FIXTURES) >= 8, "run UPDATE_FIXTURES=1 pnpm --filter @klarity/web test to write them"


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_web_contract_validates_against_canonical_schema(path: Path) -> None:
    raw = json.loads(path.read_text())
    contract = AnswerContract.model_validate(raw)
    assert contract.version == SCHEMA_VERSION
    dumped = contract.model_dump(by_alias=True, exclude_none=True)
    assert [e["id"] for e in dumped["evidence"]] == [e["id"] for e in raw["evidence"]]
    assert [f["evidenceIds"] for f in dumped["facts"]] == [f["evidenceIds"] for f in raw["facts"]]
    if contract.status in (AnswerStatus.ANSWERED, AnswerStatus.PARTIAL):
        assert contract.facts and any(s.evidence_ids for s in contract.answer)
    else:
        assert not contract.facts and not contract.evidence, "a refusal carries no claims and no evidence"
    for fact in contract.facts:
        if fact.figure:
            assert fact.figure.origin == "sql", "Rule 3: numbers come from SQL"


def test_document_locators_survive_the_round_trip() -> None:
    raw = json.loads((HERE / "fixtures" / "phoenix_over_budget.json").read_text())
    located = [e for e in raw["evidence"] if e.get("locator")]
    assert located, "at least one piece of evidence carries a page / bounding box / table locator"
    contract = AnswerContract.model_validate(raw)
    back = {e.id: e for e in contract.evidence}
    for e in located:
        loc = back[e["id"]].locator
        assert loc is not None and loc.page == e["locator"]["page"]
        if "bbox" in e["locator"]:
            assert loc.bbox is not None and 0 <= loc.bbox.x0 < loc.bbox.x1 <= 1


def test_committed_json_schema_matches_the_model() -> None:
    committed = json.loads((HERE / "answer_contract.schema.json").read_text())
    assert committed == json.loads(AnswerContract.export_json_schema()), (
        "the model changed: regenerate answer_contract.schema.json (python -m packages.schemas.answer_contract.export) "
        "and bump SCHEMA_VERSION"
    )


def test_typescript_and_python_agree_on_the_version() -> None:
    ts = (REPO / "apps/web/lib/contracts.ts").read_text()
    m = re.search(r'ANSWER_CONTRACT_VERSION = "([^"]+)"', ts)
    assert m and m.group(1) == SCHEMA_VERSION


def test_bad_bounding_box_is_rejected() -> None:
    raw = json.loads((HERE / "fixtures" / "phoenix_over_budget.json").read_text())
    for e in raw["evidence"]:
        if e.get("locator", {}).get("bbox"):
            e["locator"]["bbox"]["x1"] = e["locator"]["bbox"]["x0"]  # zero width
            break
    with pytest.raises(ValueError):
        AnswerContract.model_validate(raw)


def test_highlight_past_the_excerpt_is_rejected() -> None:
    raw = json.loads((HERE / "fixtures" / "overdue_payments.json").read_text())
    ev = next(e for e in raw["evidence"] if e.get("highlight"))
    ev["highlight"]["end"] = len(ev["excerpt"]) + 5
    with pytest.raises(ValueError):
        AnswerContract.model_validate(raw)
