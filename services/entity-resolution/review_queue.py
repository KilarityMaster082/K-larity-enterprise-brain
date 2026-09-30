# Owner task: EB-41 Entity resolution cascade
"""Human review queue for uncertain matches.

Accepting adds the mention as an alias of the chosen entity; rejecting records a cannot-link pair so the same
mention is never proposed for that entity again. Both are audited with the reviewer. Tenant-scoped: another
tenant's items are invisible.
"""

from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from enum import Enum
from typing import Callable

from tenant_context import current_tenant

from cascade import Candidate, Decision, Outcome
from resolver import Mention, normalize_name


class ReviewStatus(str, Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"      # merged into an existing entity
    SEPARATE = "separate"      # confirmed a new, distinct entity


class ReviewError(Exception):
    pass


@dataclass(frozen=True)
class ReviewItem:
    tenant_id: str
    mention: Mention
    candidates: tuple[Candidate, ...]
    reason: str
    item_id: str = field(default_factory=lambda: f"rev_{uuid.uuid4().hex[:10]}")
    status: ReviewStatus = ReviewStatus.PENDING
    resolved_entity_id: str | None = None
    reviewed_by: str | None = None
    reviewed_at: datetime | None = None


class ReviewQueue:
    def __init__(self, audit: Callable[..., None] | None = None) -> None:
        self._items: dict[tuple[str, str], ReviewItem] = {}
        self._rejected: set[tuple[str, str, str]] = set()  # (tenant, normalized name, entity_id)
        self._lock = threading.Lock()
        self._audit = audit or (lambda **_: None)

    def enqueue(self, mention: Mention, decision: Decision) -> ReviewItem:
        if decision.outcome is not Outcome.REVIEW:
            raise ReviewError("only REVIEW decisions are queued")
        tenant = current_tenant().tenant_id
        if mention.tenant_id != tenant:
            raise PermissionError("mention belongs to another tenant")
        with self._lock:
            for it in self._items.values():  # idempotent: re-ingesting the same mention doesn't duplicate work
                if it.tenant_id == tenant and it.status is ReviewStatus.PENDING and it.mention == mention:
                    return it
            item = ReviewItem(tenant, mention, decision.candidates, decision.evidence)
            self._items[(tenant, item.item_id)] = item
        return item

    def pending(self) -> list[ReviewItem]:
        tenant = current_tenant().tenant_id
        return [i for (t, _), i in self._items.items() if t == tenant and i.status is ReviewStatus.PENDING]

    def rejected_pairs(self) -> frozenset[tuple[str, str]]:
        tenant = current_tenant().tenant_id
        return frozenset((n, e) for t, n, e in self._rejected if t == tenant)

    def _get(self, item_id: str) -> ReviewItem:
        item = self._items.get((current_tenant().tenant_id, item_id))
        if item is None:
            raise ReviewError(f"no such review item: {item_id}")
        if item.status is not ReviewStatus.PENDING:
            raise ReviewError(f"{item_id} already {item.status.value}")
        return item

    def accept(self, item_id: str, entity_id: str, reviewer: str) -> ReviewItem:
        item = self._get(item_id)
        if entity_id not in {c.entity_id for c in item.candidates}:
            raise ReviewError("entity is not among the candidates")
        done = replace(item, status=ReviewStatus.ACCEPTED, resolved_entity_id=entity_id, reviewed_by=reviewer,
                       reviewed_at=datetime.now(timezone.utc))
        with self._lock:
            self._items[(item.tenant_id, item_id)] = done
            for c in item.candidates:
                if c.entity_id != entity_id:  # the reviewer chose one, so the mention is not the others
                    self._rejected.add((item.tenant_id, normalize_name(item.mention.name), c.entity_id))
        self._audit(tenant_id=item.tenant_id, action="entity.alias_added", entity_id=entity_id, user_id=reviewer,
                    details={"alias": item.mention.name, "source_ref": item.mention.source_ref})
        return done

    def keep_separate(self, item_id: str, reviewer: str) -> ReviewItem:
        item = self._get(item_id)
        done = replace(item, status=ReviewStatus.SEPARATE, reviewed_by=reviewer, reviewed_at=datetime.now(timezone.utc))
        with self._lock:
            self._items[(item.tenant_id, item_id)] = done
            for c in item.candidates:
                self._rejected.add((item.tenant_id, normalize_name(item.mention.name), c.entity_id))
        self._audit(tenant_id=item.tenant_id, action="entity.kept_separate", entity_id=item_id, user_id=reviewer,
                    details={"name": item.mention.name})
        return done
