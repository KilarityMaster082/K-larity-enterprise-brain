# Owner task: EB-47 Reasoning and answer contract
"""Writes answer_contract.schema.json next to the model: `python -m packages.schemas.answer_contract.export`."""

from __future__ import annotations

from pathlib import Path

from packages.schemas.answer_contract.schema import AnswerContract

TARGET = Path(__file__).with_name("answer_contract.schema.json")

if __name__ == "__main__":
    TARGET.write_text(AnswerContract.export_json_schema() + "\n")
    print(f"wrote {TARGET}")
