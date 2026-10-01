# Owner task: EB-66 Approval model skeleton
"""Approval service: request, decide, expire, and consume exactly once.

Guarantees (each covered by tests):
  * tenant scoping — every call runs inside the active TenantContext; another tenant's ids look like "not found";
  * separation of duties — nobody decides their own request, agents can never decide;
  * only an authorized decider (injected ``can_decide`` — OpenFGA in production) may approve or reject;
  * a request needs a reason and at least one evidence id (rule 4: answers and actions cite evidence);
  * approvals expire; an expired approval can never be consumed;
  * ``consume`` is single-use, so a workflow resumed twice performs its side effect once.

This module records decisions; it never performs the action in ``payload``. The caller runs the side effect only
after ``consume`` returns, and ``consume`` is what marks it executed.
"""

from __future__ import annotations

import threading
from datetime import datetime, timedelta
from typing import Callable, Protocol

from tenant_context import current_tenant

from .models import (
    DEFAULT_TTL, ApprovalKind, ApprovalRequest, ApprovalStatus, InvalidTransitionError, NotAuthorizedError,
    NotFoundError, RequestedVia, TERMINAL, utcnow,
)


class AuditSink(Protocol):
    def __call__(self, *, tenant_id: str, action: str, entity_id: str, user_id: str | None, details: dict) -> None: ...


class ApprovalStore(Protocol):
    def get(self, tenant_id: str, approval_id: str) -> ApprovalRequest | None: ...
    def insert(self, request: ApprovalRequest) -> None: ...
    def list(self, tenant_id: str) -> list[ApprovalRequest]: ...
    def compare_and_set(self, old: ApprovalRequest, new: ApprovalRequest) -> bool:
        """Replace ``old`` with ``new`` only if the stored row still has ``old.rev``. Atomic."""


class InMemoryApprovalStore:
    """Dev/test store. Production uses SqlApprovalStore (PostgreSQL, row-level security)."""

    def __init__(self) -> None:
        self._rows: dict[tuple[str, str], ApprovalRequest] = {}
        self._lock = threading.Lock()

    def get(self, tenant_id: str, approval_id: str) -> ApprovalRequest | None:
        return self._rows.get((tenant_id, approval_id))

    def insert(self, request: ApprovalRequest) -> None:
        with self._lock:
            key = (request.tenant_id, request.approval_id)
            if key in self._rows:
                raise ValueError(f"approval {request.approval_id} already exists")
            self._rows[key] = request

    def list(self, tenant_id: str) -> list[ApprovalRequest]:
        return sorted((r for (t, _), r in self._rows.items() if t == tenant_id), key=lambda r: (r.requested_at, r.approval_id))

    def compare_and_set(self, old: ApprovalRequest, new: ApprovalRequest) -> bool:
        with self._lock:
            key = (old.tenant_id, old.approval_id)
            current = self._rows.get(key)
            if current is None or current.rev != old.rev:
                return False
            self._rows[key] = new
            return True


def _no_audit(**_: object) -> None:
    return None


class ApprovalService:
    def __init__(
        self,
        store: ApprovalStore,
        can_decide: Callable[[str, ApprovalRequest], bool],
        audit: AuditSink = _no_audit,
        ttl: timedelta = DEFAULT_TTL,
        clock: Callable[[], datetime] = utcnow,
    ) -> None:
        self.store = store
        self.can_decide = can_decide
        self.audit = audit
        self.ttl = ttl
        self.clock = clock

    # -- helpers ---------------------------------------------------------------------------------------------
    def _load(self, approval_id: str) -> ApprovalRequest:
        req = self.store.get(current_tenant().tenant_id, approval_id)
        if req is None:
            raise NotFoundError(approval_id)
        return self._expire_if_due(req)

    def _expire_if_due(self, req: ApprovalRequest) -> ApprovalRequest:
        if req.status in (ApprovalStatus.PENDING, ApprovalStatus.APPROVED) and req.expires_at and self.clock() >= req.expires_at:
            expired = req.with_(status=ApprovalStatus.EXPIRED)
            if self.store.compare_and_set(req, expired):
                self._log("approval.expired", expired, None)
                return expired
            return self.store.get(req.tenant_id, req.approval_id) or req  # someone else changed it first
        return req

    def _log(self, action: str, req: ApprovalRequest, user_id: str | None, **details: object) -> None:
        self.audit(tenant_id=req.tenant_id, action=action, entity_id=req.approval_id, user_id=user_id,
                   details={"kind": req.kind.value, "status": req.status.value, **details})

    # -- lifecycle -------------------------------------------------------------------------------------------
    def request(self, *, kind: ApprovalKind, title: str, body: str, requested_by: str, requested_via: RequestedVia,
                reason: str, evidence_ids: tuple[str, ...], project_id: str | None = None,
                payload: dict | None = None) -> ApprovalRequest:
        if not reason.strip():
            raise ValueError("an approval request needs a reason")
        if not evidence_ids:
            raise ValueError("an approval request must cite evidence")
        now = self.clock()
        req = ApprovalRequest(
            tenant_id=current_tenant().tenant_id, kind=kind, title=title, body=body, requested_by=requested_by,
            requested_via=requested_via, reason=reason, evidence_ids=tuple(evidence_ids), project_id=project_id,
            payload=dict(payload or {}), requested_at=now, expires_at=now + self.ttl,
        )
        self.store.insert(req)
        self._log("approval.requested", req, requested_by, via=requested_via.value)
        return req

    def get(self, approval_id: str) -> ApprovalRequest:
        return self._load(approval_id)

    def list(self, status: ApprovalStatus | None = None) -> list[ApprovalRequest]:
        rows = [self._expire_if_due(r) for r in self.store.list(current_tenant().tenant_id)]
        return [r for r in rows if status is None or r.status == status]

    def _decide(self, approval_id: str, decider: str, new_status: ApprovalStatus, note: str | None) -> ApprovalRequest:
        req = self._load(approval_id)
        if req.status is not ApprovalStatus.PENDING:
            raise InvalidTransitionError(f"{approval_id} is {req.status.value}, not pending")
        if decider == req.requested_by:
            raise NotAuthorizedError("a request cannot be decided by its requester")
        if decider.startswith("agent:") or not self.can_decide(decider, req):
            raise NotAuthorizedError(f"{decider} may not decide {approval_id}")
        decided = req.with_(status=new_status, decided_by=decider, decided_at=self.clock(), note=note)
        if not self.store.compare_and_set(req, decided):
            raise InvalidTransitionError(f"{approval_id} changed concurrently")
        self._log(f"approval.{new_status.value}", decided, decider, note=note)
        return decided

    def approve(self, approval_id: str, decider: str, note: str | None = None) -> ApprovalRequest:
        return self._decide(approval_id, decider, ApprovalStatus.APPROVED, note)

    def reject(self, approval_id: str, decider: str, note: str | None = None) -> ApprovalRequest:
        return self._decide(approval_id, decider, ApprovalStatus.REJECTED, note)

    def cancel(self, approval_id: str, actor: str) -> ApprovalRequest:
        req = self._load(approval_id)
        if actor != req.requested_by:
            raise NotAuthorizedError("only the requester can cancel")
        if req.status is not ApprovalStatus.PENDING:
            raise InvalidTransitionError(f"{approval_id} is {req.status.value}, not pending")
        done = req.with_(status=ApprovalStatus.CANCELLED, decided_by=actor, decided_at=self.clock())
        if not self.store.compare_and_set(req, done):
            raise InvalidTransitionError(f"{approval_id} changed concurrently")
        self._log("approval.cancelled", done, actor)
        return done

    def consume(self, approval_id: str, executor: str) -> ApprovalRequest:
        """Mark an approved request executed. Call this immediately before the side effect; it succeeds once."""
        req = self._load(approval_id)
        if req.status is not ApprovalStatus.APPROVED:
            raise InvalidTransitionError(f"{approval_id} is {req.status.value}; only approved requests can run")
        done = req.with_(status=ApprovalStatus.EXECUTED, executed_at=self.clock())
        if not self.store.compare_and_set(req, done):
            raise InvalidTransitionError(f"{approval_id} already consumed")
        self._log("approval.executed", done, executor)
        return done
