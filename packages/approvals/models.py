# Owner task: EB-66 Approval model skeleton
"""Approval request model (CLAUDE.md rule 10: no automation side effect without an approval).

Lifecycle::

    pending ──approve──▶ approved ──consume──▶ executed   (single use)
       │                    └──────expire────▶ expired
       ├──reject──▶ rejected
       ├──cancel──▶ cancelled   (requester only)
       └──expire──▶ expired

Borrowed from: Activepieces waitpoints (A5, A6) — the idea that a flow parks on a durable approval record and
resumes exactly once; adapted with tenant scoping, separation of duties and expiry. Field names mirror the
web ``Approval`` type in apps/web/lib/data/types.ts so the approvals screen maps 1:1.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any

MODEL_VERSION = 1
DEFAULT_TTL = timedelta(hours=72)


class ApprovalKind(str, Enum):
    DRAFT_MESSAGE = "draft_message"
    CREATE_TASK = "create_task"
    UPDATE_RECORD = "update_record"


class ApprovalStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXPIRED = "expired"
    CANCELLED = "cancelled"
    EXECUTED = "executed"


class RequestedVia(str, Enum):
    ASK_BRAIN = "ask_brain"
    AGENT = "agent"
    PERSON = "person"


TERMINAL = frozenset({ApprovalStatus.REJECTED, ApprovalStatus.EXPIRED, ApprovalStatus.CANCELLED, ApprovalStatus.EXECUTED})


class ApprovalError(Exception):
    """Base class."""


class NotFoundError(ApprovalError):
    """No such approval in the active tenant (also returned for other tenants' ids)."""


class InvalidTransitionError(ApprovalError):
    """The approval is not in a state that allows this action."""


class NotAuthorizedError(ApprovalError):
    """The actor may not perform this action on this approval."""


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class ApprovalRequest:
    tenant_id: str
    kind: ApprovalKind
    title: str
    body: str
    requested_by: str
    requested_via: RequestedVia
    reason: str
    evidence_ids: tuple[str, ...] = ()
    project_id: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)  # what will run on approval; never executed here
    approval_id: str = field(default_factory=lambda: f"apr_{uuid.uuid4().hex[:12]}")
    status: ApprovalStatus = ApprovalStatus.PENDING
    requested_at: datetime = field(default_factory=utcnow)
    expires_at: datetime | None = None
    decided_by: str | None = None
    decided_at: datetime | None = None
    note: str | None = None
    executed_at: datetime | None = None
    version: int = MODEL_VERSION
    rev: int = 0  # row revision: bumped by every change, used for compare-and-set in stores

    def with_(self, **changes: Any) -> "ApprovalRequest":
        return replace(self, **{"rev": self.rev + 1, **changes})

    def to_dict(self) -> dict[str, Any]:
        """Wire shape used by the web approvals screen (camelCase, ISO times)."""
        iso = lambda d: d.isoformat() if d else None  # noqa: E731
        out = {
            "approvalId": self.approval_id, "kind": self.kind.value, "title": self.title, "body": self.body,
            "projectId": self.project_id, "requestedBy": self.requested_by, "requestedVia": self.requested_via.value,
            "requestedAt": iso(self.requested_at), "reason": self.reason, "evidenceIds": list(self.evidence_ids),
            "status": self.status.value, "decidedBy": self.decided_by, "decidedAt": iso(self.decided_at),
            "note": self.note, "expiresAt": iso(self.expires_at),
        }
        return {k: v for k, v in out.items() if v is not None}
