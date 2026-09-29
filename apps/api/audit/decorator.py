# Owner task: EB-24 Audit log
"""API route decorator and middleware writing append-only audit rows.

Records every API invocation into the database with tenant, user, action, object, and result.
App-role permissions are strictly append-only (UPDATE and DELETE are revoked).
"""

from __future__ import annotations

import functools
import json
import time
from collections.abc import Callable
from typing import Any, Protocol, Sequence

from apps.api.audit.events import AuditEvent
from tenant_context import current_tenant_or_none


class AuditWriter(Protocol):
    """Destination for writing audit records."""

    def write(self, event: AuditEvent) -> None: ...


class InMemoryAuditWriter:
    """In-memory audit store for testing and development."""

    def __init__(self) -> None:
        self.events: list[AuditEvent] = []

    def write(self, event: AuditEvent) -> None:
        self.events.append(event)

    def by_tenant(self, tenant_id: str) -> list[AuditEvent]:
        return [e for e in self.events if e.tenant_id == tenant_id]

    def clear(self) -> None:
        self.events.clear()


class DatabaseAuditWriter:
    """Writes audit events to the database audit_log table."""

    def __init__(self, session_or_conn: Any) -> None:
        self.session_or_conn = session_or_conn

    def write(self, event: AuditEvent) -> None:
        sql = """
            INSERT INTO audit_log (
                audit_id, tenant_id, user_id, action, entity_type,
                entity_id, details, ip_address, user_agent, created_at
            ) VALUES (
                :audit_id, :tenant_id, :user_id, :action, :entity_type,
                :entity_id, :details, :ip_address, :user_agent, :created_at
            )
        """
        params = {
            "audit_id": event.audit_id,
            "tenant_id": event.tenant_id,
            "user_id": event.user_id,
            "action": event.action,
            "entity_type": event.entity_type,
            "entity_id": event.entity_id,
            "details": json.dumps(event.details),
            "ip_address": event.ip_address,
            "user_agent": event.user_agent,
            "created_at": event.created_at,
        }
        if hasattr(self.session_or_conn, "execute"):
            self.session_or_conn.execute(sql, params)
        elif hasattr(self.session_or_conn, "cursor"):
            cur = self.session_or_conn.cursor()
            cur.execute(
                """
                INSERT INTO audit_log (
                    audit_id, tenant_id, user_id, action, entity_type,
                    entity_id, details, ip_address, user_agent, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    event.audit_id, event.tenant_id, event.user_id, event.action,
                    event.entity_type, event.entity_id, json.dumps(event.details),
                    event.ip_address, event.user_agent, event.created_at,
                ),
            )


# Global default writer (can be configured by apps/api composition root)
_GLOBAL_AUDIT_WRITER: AuditWriter = InMemoryAuditWriter()


def set_audit_writer(writer: AuditWriter) -> None:
    global _GLOBAL_AUDIT_WRITER
    _GLOBAL_AUDIT_WRITER = writer


def get_audit_writer() -> AuditWriter:
    return _GLOBAL_AUDIT_WRITER


def audit_action(
    action: str,
    entity_type: str,
    *,
    entity_id_getter: Callable[..., str] | None = None,
    writer: AuditWriter | None = None,
) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """Decorator to audit an API route execution.

    Writes an AuditEvent capturing the active tenant, user, action, object, and result status.
    """

    def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
        @functools.wraps(fn)
        def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
            active_writer = writer or _GLOBAL_AUDIT_WRITER
            ctx = current_tenant_or_none()
            tenant_id = ctx.tenant_id if ctx else "unknown"

            entity_id = entity_id_getter(*args, **kwargs) if entity_id_getter else kwargs.get("id", "none")
            user_id = kwargs.get("user_id")

            t0 = time.monotonic()
            status = "success"
            error_msg = None
            try:
                result = fn(*args, **kwargs)
                return result
            except Exception as e:
                status = "error"
                error_msg = str(e)
                raise
            finally:
                duration_ms = (time.monotonic() - t0) * 1000
                event = AuditEvent(
                    tenant_id=tenant_id,
                    user_id=user_id,
                    action=action,
                    entity_type=entity_type,
                    entity_id=str(entity_id),
                    details={
                        "status": status,
                        "duration_ms": round(duration_ms, 2),
                        "error": error_msg,
                    },
                )
                active_writer.write(event)

        @functools.wraps(fn)
        async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
            active_writer = writer or _GLOBAL_AUDIT_WRITER
            ctx = current_tenant_or_none()
            tenant_id = ctx.tenant_id if ctx else "unknown"

            entity_id = entity_id_getter(*args, **kwargs) if entity_id_getter else kwargs.get("id", "none")
            user_id = kwargs.get("user_id")

            t0 = time.monotonic()
            status = "success"
            error_msg = None
            try:
                result = await fn(*args, **kwargs)
                return result
            except Exception as e:
                status = "error"
                error_msg = str(e)
                raise
            finally:
                duration_ms = (time.monotonic() - t0) * 1000
                event = AuditEvent(
                    tenant_id=tenant_id,
                    user_id=user_id,
                    action=action,
                    entity_type=entity_type,
                    entity_id=str(entity_id),
                    details={
                        "status": status,
                        "duration_ms": round(duration_ms, 2),
                        "error": error_msg,
                    },
                )
                active_writer.write(event)

        import inspect
        return async_wrapper if inspect.iscoroutinefunction(fn) else sync_wrapper

    return decorator
