# Owner task: EB-24 Audit log (PostgreSQL writer)
"""AuditWriter that appends to the ``audit_log`` table (db/migrations/0006, append-only by trigger and grants).

Replaces DatabaseAuditWriter, which sent a raw string to SQLAlchemy (rejected by SQLAlchemy 2) and never bound the
tenant, so row-level security would have refused every insert. This writer goes through the tenant-scoped record
store: explicit tenant filter plus ``app.tenant_id`` binding."""

from __future__ import annotations

from typing import Any

from storage import SqlRecordStore
from tenant_context import current_tenant

from .events import AuditEvent

COLUMNS = {
    "audit_id": "text", "tenant_id": "text", "user_id": "text", "action": "text", "entity_type": "text",
    "entity_id": "text", "details": "json", "ip_address": "text", "user_agent": "text", "created_at": "timestamp",
}


class SqlAuditWriter:
    def __init__(self, engine: Any) -> None:
        self._rows = SqlRecordStore(engine, "audit_log", "audit_id", COLUMNS, version_column=None)

    def write(self, event: AuditEvent) -> None:
        self._rows.insert(event.tenant_id, event.to_dict())

    def by_tenant(self, tenant_id: str, limit: int | None = None) -> list[AuditEvent]:
        rows = self._rows.list(tenant_id, order_by="created_at", limit=limit)
        return [AuditEvent(**r) for r in rows]
