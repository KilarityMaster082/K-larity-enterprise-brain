# Owner task: EB-53 Decision Memory (PostgreSQL persistence)
"""DecisionStore backed by the ``decisions`` table (db/migrations/0001 + 0006). Tenant isolation and compare-and-set
live in storage.SqlRecordStore; this module only maps rows to Decision."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from storage import RecordConflictError, SqlRecordStore

from decision_memory import Decision, DecisionStatus, InvalidChange

COLUMNS = {
    "tenant_id": "text", "decision_id": "text", "project_id": "text", "title": "text", "description": "text",
    "rationale": "text", "status": "text", "decided_by": "text", "decided_at": "timestamp", "superseded_by": "text",
    "source_ref": "text", "alternatives": "json", "evidence_ids": "json", "cost_impact": "numeric",
    "time_impact_days": "int", "confidence": "numeric", "reviewed_by": "text", "review_note": "text", "version": "int",
}


def to_row(d: Decision) -> dict[str, Any]:
    return {
        "tenant_id": d.tenant_id, "decision_id": d.decision_id, "project_id": d.project_id, "title": d.title,
        "description": d.description, "rationale": d.rationale, "status": d.status.value, "decided_by": d.decided_by,
        "decided_at": d.decided_at, "superseded_by": d.superseded_by, "source_ref": d.source_ref,
        "alternatives": list(d.alternatives), "evidence_ids": list(d.evidence_ids), "cost_impact": d.cost_impact,
        "time_impact_days": d.time_impact_days, "confidence": None if d.confidence is None else str(d.confidence),
        "reviewed_by": d.reviewed_by, "review_note": d.review_note, "version": d.version,
    }


def from_row(row: dict[str, Any]) -> Decision:
    return Decision(
        tenant_id=row["tenant_id"], decision_id=row["decision_id"], project_id=row["project_id"], title=row["title"],
        description=row["description"], evidence_ids=tuple(row["evidence_ids"]), status=DecisionStatus(row["status"]),
        rationale=row["rationale"], alternatives=tuple(row["alternatives"] or ()), cost_impact=row["cost_impact"],
        time_impact_days=row["time_impact_days"], confidence=None if row["confidence"] is None else float(row["confidence"]),
        decided_by=row["decided_by"], decided_at=datetime.fromisoformat(row["decided_at"]) if row["decided_at"] else None,
        superseded_by=row["superseded_by"], reviewed_by=row["reviewed_by"], review_note=row["review_note"],
        source_ref=row["source_ref"], version=int(row["version"]),
    )


class SqlDecisionStore:
    def __init__(self, engine: Any) -> None:  # a SQLAlchemy Engine; only packages/storage imports SQLAlchemy
        self._rows = SqlRecordStore(engine, "decisions", "decision_id", COLUMNS, version_column="version")

    def get(self, tenant_id: str, decision_id: str) -> Decision | None:
        row = self._rows.get(tenant_id, decision_id)
        return from_row(row) if row else None

    def insert(self, decision: Decision) -> None:
        try:
            self._rows.insert(decision.tenant_id, to_row(decision))
        except RecordConflictError as exc:
            raise InvalidChange(f"{decision.decision_id} already exists") from exc

    def list(self, tenant_id: str) -> list[Decision]:
        return [from_row(r) for r in self._rows.list(tenant_id)]

    def compare_and_set(self, old: Decision, new: Decision) -> bool:
        return self._rows.update_if_version(old.tenant_id, to_row(new), old.version)
