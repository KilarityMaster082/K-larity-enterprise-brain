# Owner task: EB-53 Decision Memory
"""Decision Memory: drafts extracted from sources, confirmed or rejected by a human, linked when superseded.

Rules encoded here (each covered by a test):
  * a decision needs evidence — nothing is stored, or confirmed, without at least one evidence id (rule 4);
  * extraction only ever creates ``proposed`` drafts; a person confirms, edits or rejects (rule 10: the model
    never decides anything on its own);
  * reviewing requires the ``reviewer`` relation in OpenFGA (injected as ``can_review``);
  * supersession keeps an acyclic chain inside one project and only from a ``decided`` decision;
  * every transition writes an audit event; everything is tenant-scoped;
  * ``propose_from_event`` is idempotent, so re-ingesting a source never duplicates drafts.

Status values are the ``decisions`` table CHECK set: proposed | decided | superseded | revoked.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Protocol

from tenant_context import current_tenant


class DecisionStatus(str, Enum):
    PROPOSED = "proposed"
    DECIDED = "decided"
    SUPERSEDED = "superseded"
    REVOKED = "revoked"


class DecisionError(Exception):
    pass


class NotFound(DecisionError):
    pass


class NotAuthorized(DecisionError):
    pass


class InvalidChange(DecisionError):
    pass


_EDITABLE = frozenset({"title", "description", "rationale", "alternatives", "cost_impact", "time_impact_days"})


@dataclass(frozen=True)
class Decision:
    tenant_id: str
    decision_id: str
    project_id: str | None
    title: str
    description: str
    evidence_ids: tuple[str, ...]
    status: DecisionStatus = DecisionStatus.PROPOSED
    rationale: str | None = None
    alternatives: tuple[str, ...] = ()
    cost_impact: str | None = None       # decimal string copied from a source/SQL, never a float
    time_impact_days: int | None = None
    confidence: float | None = None      # extractor confidence for drafts
    decided_by: str | None = None
    decided_at: datetime | None = None
    superseded_by: str | None = None
    reviewed_by: str | None = None
    review_note: str | None = None
    source_ref: str | None = None
    version: int = 1

    def to_web(self) -> dict[str, Any]:
        """Shape of the web ``Decision`` type (apps/web/lib/data/types.ts)."""
        out = {
            "decisionId": self.decision_id, "projectId": self.project_id, "title": self.title,
            "description": self.description, "rationale": self.rationale, "status": self.status.value,
            "decidedBy": self.decided_by, "decidedAt": self.decided_at.isoformat() if self.decided_at else None,
            "supersededBy": self.superseded_by, "alternatives": list(self.alternatives),
            "costImpact": self.cost_impact, "timeImpactDays": self.time_impact_days,
            "evidenceIds": list(self.evidence_ids), "confidence": self.confidence,
            "reviewedBy": self.reviewed_by, "reviewNote": self.review_note,
        }
        return {k: v for k, v in out.items() if v is not None}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class DecisionStore(Protocol):
    def get(self, tenant_id: str, decision_id: str) -> "Decision | None": ...
    def insert(self, decision: "Decision") -> None: ...
    def list(self, tenant_id: str) -> "list[Decision]": ...
    def compare_and_set(self, old: "Decision", new: "Decision") -> bool:
        """Replace ``old`` with ``new`` only if the stored row still has ``old.version``. Atomic."""


class InMemoryDecisionStore:
    def __init__(self) -> None:
        self._rows: "dict[tuple[str, str], Decision]" = {}
        self._lock = threading.Lock()

    def get(self, tenant_id: str, decision_id: str) -> "Decision | None":
        return self._rows.get((tenant_id, decision_id))

    def insert(self, decision: "Decision") -> None:
        with self._lock:
            key = (decision.tenant_id, decision.decision_id)
            if key in self._rows:
                raise InvalidChange(f"{decision.decision_id} already exists")
            self._rows[key] = decision

    def list(self, tenant_id: str) -> "list[Decision]":
        return [d for (t, _), d in self._rows.items() if t == tenant_id]

    def compare_and_set(self, old: "Decision", new: "Decision") -> bool:
        with self._lock:
            key = (old.tenant_id, old.decision_id)
            current = self._rows.get(key)
            if current is None or current.version != old.version:
                return False
            self._rows[key] = new
            return True


class DecisionMemory:
    def __init__(self, can_review: Callable[[str, Decision], bool], audit: Callable[..., None] | None = None,
                 clock: Callable[[], datetime] = _utcnow, store: DecisionStore | None = None) -> None:
        self.store: DecisionStore = store or InMemoryDecisionStore()
        self.can_review, self._audit, self.clock = can_review, audit or (lambda **_: None), clock

    # -- helpers ---------------------------------------------------------------------------------------------
    def _get(self, decision_id: str) -> Decision:
        d = self.store.get(current_tenant().tenant_id, decision_id)
        if d is None:
            raise NotFound(decision_id)
        return d

    def _audit_write(self, d: Decision, action: str, user: str | None, **details: Any) -> Decision:
        self._audit(tenant_id=d.tenant_id, action=f"decision.{action}", entity_id=d.decision_id, user_id=user,
                    details={"status": d.status.value, **details})
        return d

    def _commit(self, old: Decision, new: Decision, action: str, user: str | None, **details: Any) -> Decision:
        """Write a change only if nobody changed the decision since it was read (optimistic concurrency)."""
        if not self.store.compare_and_set(old, new):
            raise InvalidChange(f"{old.decision_id} was changed by someone else; reload and retry")
        return self._audit_write(new, action, user, **details)

    def _authorize(self, user: str, d: Decision) -> None:
        if user.startswith("agent:") or not self.can_review(user, d):
            raise NotAuthorized(f"{user} may not review {d.decision_id}")

    # -- creation --------------------------------------------------------------------------------------------
    def propose(self, *, decision_id: str, project_id: str | None, title: str, description: str,
                evidence_ids: tuple[str, ...], confidence: float | None = None, source_ref: str | None = None,
                rationale: str | None = None, cost_impact: str | None = None) -> Decision:
        if not evidence_ids:
            raise InvalidChange("a decision needs evidence")
        if not title.strip():
            raise InvalidChange("a decision needs a title")
        tenant = current_tenant().tenant_id
        existing = self.store.get(tenant, decision_id)
        if existing is not None:
            return existing  # idempotent: same source re-ingested
        d = Decision(tenant, decision_id, project_id, title.strip(), description, tuple(evidence_ids), confidence=confidence,
                     source_ref=source_ref, rationale=rationale, cost_impact=cost_impact)
        try:
            self.store.insert(d)
        except InvalidChange:  # lost a race with an identical proposal: return the winner
            winner = self.store.get(tenant, decision_id)
            if winner is None:
                raise
            return winner
        return self._audit_write(d, "proposed", None, source_ref=source_ref, confidence=confidence)

    def propose_from_event(self, event: Any, evidence_id: str) -> Decision:
        """Create a draft from an EB-37 ``ExtractedEvent`` of type ``decision`` (id derived from the event id)."""
        if getattr(event.event_type, "value", event.event_type) != "decision":
            raise InvalidChange("only decision events become decision drafts")
        if event.tenant_id != current_tenant().tenant_id:
            raise NotAuthorized("event belongs to another tenant")
        return self.propose(decision_id=f"dec-{event.event_id.removeprefix('ev-')}", project_id=event.project_id,
                            title=event.title, description=event.quote, evidence_ids=(evidence_id,),
                            confidence=event.confidence, source_ref=event.source_ref)

    # -- review ----------------------------------------------------------------------------------------------
    def confirm(self, decision_id: str, reviewer: str, note: str | None = None) -> Decision:
        d = self._get(decision_id)
        self._authorize(reviewer, d)
        if d.status is not DecisionStatus.PROPOSED:
            raise InvalidChange(f"{decision_id} is {d.status.value}, not proposed")
        if not d.evidence_ids:
            raise InvalidChange("cannot confirm a decision without evidence")
        return self._commit(d, replace(d, status=DecisionStatus.DECIDED, decided_by=reviewer, decided_at=self.clock(),
                                       reviewed_by=reviewer, review_note=note, version=d.version + 1), "confirmed", reviewer, note=note)

    def edit(self, decision_id: str, reviewer: str, **changes: Any) -> Decision:
        d = self._get(decision_id)
        self._authorize(reviewer, d)
        bad = set(changes) - _EDITABLE
        if bad:
            raise InvalidChange(f"not editable: {sorted(bad)}")
        if d.status not in (DecisionStatus.PROPOSED, DecisionStatus.DECIDED):
            raise InvalidChange(f"{decision_id} is {d.status.value} and read-only")
        if "alternatives" in changes:
            changes["alternatives"] = tuple(changes["alternatives"])
        return self._commit(d, replace(d, **changes, reviewed_by=reviewer, version=d.version + 1), "edited", reviewer,
                            fields=sorted(changes))

    def reject(self, decision_id: str, reviewer: str, note: str | None = None) -> Decision:
        d = self._get(decision_id)
        self._authorize(reviewer, d)
        if d.status not in (DecisionStatus.PROPOSED, DecisionStatus.DECIDED):
            raise InvalidChange(f"{decision_id} is {d.status.value}")
        return self._commit(d, replace(d, status=DecisionStatus.REVOKED, reviewed_by=reviewer, review_note=note,
                                       version=d.version + 1), "rejected", reviewer, note=note)

    def supersede(self, old_id: str, new_id: str, reviewer: str) -> Decision:
        old, new = self._get(old_id), self._get(new_id)
        self._authorize(reviewer, old)
        if old_id == new_id:
            raise InvalidChange("a decision cannot supersede itself")
        if old.status is not DecisionStatus.DECIDED or new.status is not DecisionStatus.DECIDED:
            raise InvalidChange("both decisions must be decided")
        if old.project_id != new.project_id:
            raise InvalidChange("supersession must stay inside one project")
        cursor, seen = new, {old_id}
        while cursor.superseded_by:  # walk forward from the new one: reaching old would close a cycle
            if cursor.superseded_by in seen:
                raise InvalidChange("supersession would create a cycle")
            seen.add(cursor.superseded_by)
            cursor = self._get(cursor.superseded_by)
        return self._commit(old, replace(old, status=DecisionStatus.SUPERSEDED, superseded_by=new_id, version=old.version + 1),
                            "superseded", reviewer, superseded_by=new_id)

    # -- reads -----------------------------------------------------------------------------------------------
    def get(self, decision_id: str) -> Decision:
        return self._get(decision_id)

    def list(self, project_id: str | None = None, status: DecisionStatus | None = None) -> list[Decision]:
        rows = self.store.list(current_tenant().tenant_id)
        return [d for d in rows if (project_id is None or d.project_id == project_id) and (status is None or d.status == status)]

    def history(self, decision_id: str) -> list[Decision]:
        """The decision and everything that replaced it, oldest first."""
        chain, cursor, seen = [], self._get(decision_id), set()
        while cursor.decision_id not in seen:
            chain.append(cursor)
            seen.add(cursor.decision_id)
            if not cursor.superseded_by:
                break
            cursor = self._get(cursor.superseded_by)
        return chain
