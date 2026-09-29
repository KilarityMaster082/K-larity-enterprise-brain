# Owner task: EB-29 Temporal ingestion pipeline
"""Dead-letter queue storage and administrative inspection for failed ingestion items.

Subtask 4: Dead-letter table + admin list.
Items that encounter non-recoverable errors or exceed maximum activity retry attempts
are deposited here with full diagnostic metadata, preventing poisoned messages from
stalling the entire source synchronization workflow.
"""

from __future__ import annotations

import datetime
from dataclasses import dataclass, field
from typing import Any
import uuid


@dataclass
class DeadLetterItem:
    """Diagnostic record of an item that failed pipeline processing."""

    id: str
    tenant_id: str
    source_id: str
    item_ref: str
    stage: str
    error_type: str
    error_message: str
    idempotency_key: str
    attempt_count: int = 1
    payload_ref: str | None = None
    failed_at: str = field(default_factory=lambda: datetime.datetime.now(datetime.timezone.utc).isoformat())
    resolved: bool = False
    resolved_at: str | None = None
    resolved_by: str | None = None
    resolution_notes: str | None = None


class DeadLetterStore:
    """In-memory and transactional store for ingestion dead-letter records."""

    def __init__(self) -> None:
        self._items: dict[str, DeadLetterItem] = {}

    def record(
        self,
        tenant_id: str,
        source_id: str,
        item_ref: str,
        stage: str,
        error_type: str,
        error_message: str,
        idempotency_key: str,
        attempt_count: int = 1,
        payload_ref: str | None = None,
    ) -> DeadLetterItem:
        """Records an unrecoverable failure into the dead-letter store."""
        item_id = str(uuid.uuid4())
        item = DeadLetterItem(
            id=item_id,
            tenant_id=tenant_id,
            source_id=source_id,
            item_ref=item_ref,
            stage=stage,
            error_type=error_type,
            error_message=error_message,
            idempotency_key=idempotency_key,
            attempt_count=attempt_count,
            payload_ref=payload_ref,
        )
        self._items[item_id] = item
        return item

    def list_for_tenant(
        self,
        tenant_id: str,
        source_id: str | None = None,
        unresolved_only: bool = True,
        limit: int = 50,
    ) -> list[DeadLetterItem]:
        """Admin list function returning dead-letter items for inspection."""
        matches = [
            it for it in self._items.values()
            if it.tenant_id == tenant_id
            and (source_id is None or it.source_id == source_id)
            and (not unresolved_only or not it.resolved)
        ]
        matches.sort(key=lambda x: x.failed_at, reverse=True)
        return matches[:limit]

    def get(self, tenant_id: str, item_id: str) -> DeadLetterItem | None:
        item = self._items.get(item_id)
        if item and item.tenant_id == tenant_id:
            return item
        return None

    def resolve(
        self,
        tenant_id: str,
        item_id: str,
        resolved_by: str,
        notes: str | None = None,
    ) -> bool:
        """Marks a dead-letter item as resolved after review or replay."""
        item = self.get(tenant_id, item_id)
        if not item:
            return False
        item.resolved = True
        item.resolved_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
        item.resolved_by = resolved_by
        item.resolution_notes = notes
        return True

    def count_by_stage(self, tenant_id: str) -> dict[str, int]:
        """Provides failure breakdown by pipeline stage for admin dashboards."""
        counts: dict[str, int] = {}
        for it in self.list_for_tenant(tenant_id, unresolved_only=True, limit=1000):
            counts[it.stage] = counts.get(it.stage, 0) + 1
        return counts

    def clear(self) -> None:
        self._items.clear()
