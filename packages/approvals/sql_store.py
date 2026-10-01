# Owner task: EB-66 Approval model skeleton (PostgreSQL persistence)
"""ApprovalStore backed by the ``approvals`` table (db/migrations/0006). Isolation and concurrency live in
storage.SqlRecordStore; this module only maps rows to ApprovalRequest."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from storage import RecordConflictError, SqlRecordStore

from .models import ApprovalKind, ApprovalRequest, ApprovalStatus, RequestedVia

COLUMNS = {
    "tenant_id": "text", "approval_id": "text", "kind": "text", "title": "text", "body": "text", "project_id": "text",
    "requested_by": "text", "requested_via": "text", "requested_at": "timestamp", "reason": "text",
    "evidence_ids": "json", "payload": "json", "status": "text", "expires_at": "timestamp", "decided_by": "text",
    "decided_at": "timestamp", "note": "text", "executed_at": "timestamp", "rev": "int",
}


def _dt(value: Any) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def to_row(r: ApprovalRequest) -> dict[str, Any]:
    return {
        "tenant_id": r.tenant_id, "approval_id": r.approval_id, "kind": r.kind.value, "title": r.title, "body": r.body,
        "project_id": r.project_id, "requested_by": r.requested_by, "requested_via": r.requested_via.value,
        "requested_at": r.requested_at, "reason": r.reason, "evidence_ids": list(r.evidence_ids), "payload": r.payload,
        "status": r.status.value, "expires_at": r.expires_at, "decided_by": r.decided_by, "decided_at": r.decided_at,
        "note": r.note, "executed_at": r.executed_at, "rev": r.rev,
    }


def from_row(row: dict[str, Any]) -> ApprovalRequest:
    return ApprovalRequest(
        tenant_id=row["tenant_id"], approval_id=row["approval_id"], kind=ApprovalKind(row["kind"]), title=row["title"],
        body=row["body"], requested_by=row["requested_by"], requested_via=RequestedVia(row["requested_via"]),
        reason=row["reason"], evidence_ids=tuple(row["evidence_ids"]), project_id=row["project_id"],
        payload=dict(row["payload"] or {}), status=ApprovalStatus(row["status"]), requested_at=_dt(row["requested_at"]),
        expires_at=_dt(row["expires_at"]), decided_by=row["decided_by"], decided_at=_dt(row["decided_at"]),
        note=row["note"], executed_at=_dt(row["executed_at"]), rev=int(row["rev"]),
    )


class SqlApprovalStore:
    def __init__(self, engine: Any) -> None:  # a SQLAlchemy Engine; only packages/storage imports SQLAlchemy
        self._rows = SqlRecordStore(engine, "approvals", "approval_id", COLUMNS, version_column="rev")

    def get(self, tenant_id: str, approval_id: str) -> ApprovalRequest | None:
        row = self._rows.get(tenant_id, approval_id)
        return from_row(row) if row else None

    def insert(self, request: ApprovalRequest) -> None:
        try:
            self._rows.insert(request.tenant_id, to_row(request))
        except RecordConflictError as exc:
            raise ValueError(f"approval {request.approval_id} already exists") from exc

    def list(self, tenant_id: str) -> list[ApprovalRequest]:
        rows = [from_row(r) for r in self._rows.list(tenant_id)]
        return sorted(rows, key=lambda r: (r.requested_at, r.approval_id))

    def compare_and_set(self, old: ApprovalRequest, new: ApprovalRequest) -> bool:
        return self._rows.update_if_version(old.tenant_id, to_row(new), old.rev)
