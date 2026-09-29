# Owner task: EB-24 Audit log
"""Structured audit log events and tenant retention policies.

Records tamper-evident audit logs:
- User actions and API invocations.
- Retrieved source citations for answers (Risk R-6, R-10).
- Administrative modifications and permission checks.
- Per-tenant retention policies (default: 90 days; configurable).
"""

from __future__ import annotations

import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Sequence

DEFAULT_RETENTION_DAYS = 90


@dataclass(frozen=True)
class AuditEvent:
    """Represents an append-only audit event in the database."""

    tenant_id: str
    action: str
    entity_type: str
    entity_id: str
    user_id: str | None = None
    details: dict[str, Any] = field(default_factory=dict)
    ip_address: str | None = None
    user_agent: str | None = None
    audit_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class TenantRetentionPolicy:
    """Retention configuration for a tenant's audit trail."""

    tenant_id: str
    retention_days: int = DEFAULT_RETENTION_DAYS
    compliance_lock: bool = False  # If True, records cannot be pruned before retention_days

    def cutoff_timestamp(self, now: datetime | None = None) -> datetime:
        """Calculate the earliest timestamp that must be preserved."""
        ref = now or datetime.now(timezone.utc)
        return ref - timedelta(days=self.retention_days)


# Tenant-specific retention overrides (cell/registry configuration)
_TENANT_RETENTION_REGISTRY: dict[str, TenantRetentionPolicy] = {}


def set_tenant_retention_policy(policy: TenantRetentionPolicy) -> None:
    """Configure or update the retention policy for a tenant."""
    if policy.retention_days < 30:
        raise ValueError("Retention period must be at least 30 days for regulatory compliance")
    _TENANT_RETENTION_REGISTRY[policy.tenant_id] = policy


def get_tenant_retention_policy(tenant_id: str) -> TenantRetentionPolicy:
    """Get the active retention policy for a tenant."""
    return _TENANT_RETENTION_REGISTRY.get(
        tenant_id,
        TenantRetentionPolicy(tenant_id=tenant_id, retention_days=DEFAULT_RETENTION_DAYS),
    )


def create_retrieval_audit_event(
    tenant_id: str,
    user_id: str | None,
    query_id: str,
    retrieved_source_ids: Sequence[str],
    *,
    question: str | None = None,
    duration_ms: float | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> AuditEvent:
    """Helper to record an answer retrieval event with explicit source citations."""
    return AuditEvent(
        tenant_id=tenant_id,
        user_id=user_id,
        action="ask.retrieval",
        entity_type="query",
        entity_id=query_id,
        details={
            "retrieved_source_ids": list(retrieved_source_ids),
            "source_count": len(retrieved_source_ids),
            "question_preview": question[:120] if question else None,
            "duration_ms": duration_ms,
        },
        ip_address=ip_address,
        user_agent=user_agent,
    )
