# Owner task: EB-53 Decision Memory · EB-66 Approval model (API wiring)
"""Service container: the domain services handlers use, built once per app.

Everything here is tenant-scoped by the services themselves (they read the active TenantContext), so handlers
never pass a tenant id around. Production swaps the in-memory stores for Postgres-backed ones behind the same
interfaces; permissions go through OpenFGA via ``PermissionsClient``.

Demo data is seeded lazily per tenant and ONLY in development auth mode, so a production container starts empty.
"""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

from apps.api.audit import AuditEvent, InMemoryAuditWriter, SqlAuditWriter
from decision_memory import Decision, DecisionMemory, DecisionStatus
from packages.approvals import ApprovalKind, ApprovalRequest, ApprovalService, InMemoryApprovalStore, RequestedVia
from packages.permissions import PermissionsClient
from storage import FgaStore, LocalFgaBackend, TupleKey
from tenant_context import current_tenant

DEV_ADMIN = "dev-admin"
DEV_MEMBER = "dev-member"


@dataclass
class Services:
    decisions: DecisionMemory
    approvals: ApprovalService
    permissions: PermissionsClient
    fga: FgaStore
    audit: Any  # InMemoryAuditWriter | SqlAuditWriter: write(event) / by_tenant(tenant_id)
    demo: bool = False
    finance_executor: Callable[..., Any] | None = None  # reviewed-SQL executor; None until the DB is wired
    _seeded: set[str] = field(default_factory=set)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    @classmethod
    def in_memory(cls, *, demo: bool = False) -> "Services":
        return cls._build(InMemoryAuditWriter(), None, None, demo)

    @classmethod
    def from_engine(cls, engine: Any, *, demo: bool = False) -> "Services":
        """PostgreSQL-backed decisions, approvals and audit trail (connect as the NOBYPASSRLS application role)."""
        from decision_sql_store import SqlDecisionStore
        from packages.approvals.sql_store import SqlApprovalStore

        return cls._build(SqlAuditWriter(engine), SqlDecisionStore(engine), SqlApprovalStore(engine), demo)

    @classmethod
    def from_env(cls, *, demo: bool = False) -> "Services":
        """Production composition: DATABASE_APP_ROLE_URL selects PostgreSQL. Without it, refuse to start rather than
        silently keep decisions, approvals and the audit trail in memory — unless KLARITY_ALLOW_MEMORY_STORES=1."""
        url = os.environ.get("DATABASE_APP_ROLE_URL")
        if url:
            from storage import create_app_engine

            return cls.from_engine(create_app_engine(url), demo=demo)
        if os.environ.get("KLARITY_ALLOW_MEMORY_STORES") == "1" or demo:
            return cls.in_memory(demo=demo)
        raise RuntimeError("DATABASE_APP_ROLE_URL is not set: refusing to run with in-memory decisions/approvals/audit "
                           "(set KLARITY_ALLOW_MEMORY_STORES=1 for a throwaway run)")

    @classmethod
    def _build(cls, audit: Any, decision_store: Any, approval_store: Any, demo: bool) -> "Services":
        fga = FgaStore(LocalFgaBackend(), cache_ttl_seconds=0)
        perms = PermissionsClient(fga)

        def write_audit(*, tenant_id: str, action: str, entity_id: str, user_id: str | None, details: dict[str, Any]) -> None:
            audit.write(AuditEvent(tenant_id=tenant_id, action=action, entity_type=action.split(".")[0],
                                   entity_id=entity_id, user_id=user_id, details=details))

        def can_decide_approval(user: str, req: ApprovalRequest) -> bool:
            # Approving an action needs edit rights on its project, or tenant admin when it has none.
            if req.project_id:
                return perms.can_edit_project(user, req.project_id)
            return fga.check(f"user:{user}", "admin", f"tenant:{current_tenant().tenant_id}")

        def can_review_decision(user: str, d: Decision) -> bool:
            return perms.can_review_decision(user, d.decision_id)

        return cls(
            decisions=DecisionMemory(can_review=can_review_decision, audit=lambda **kw: write_audit(**kw), store=decision_store),
            approvals=ApprovalService(approval_store or InMemoryApprovalStore(), can_decide=can_decide_approval, audit=write_audit),
            permissions=perms, fga=fga, audit=audit, demo=demo,
        )

    def can_see_finance(self, user_id: str, project_id: str | None) -> bool:
        """Finance figures need ``finance_viewer``: on the project, or on the tenant when no project is named."""
        if project_id:
            return self.permissions.can_view_finance(user_id, project_id)
        return self.fga.check(f"user:{user_id}", "finance_viewer", f"tenant:{current_tenant().tenant_id}")

    def can_see_project(self, user_id: str, project_id: str) -> bool:
        return self.permissions.can_view_project(user_id, project_id)

    @property
    def finance_available(self) -> bool:
        """True when figures come from a configured SQL executor, or from demo fixtures in development mode."""
        return self.finance_executor is not None or self.demo

    def ensure_demo(self) -> None:
        """Development only: seed one tenant's demo decisions, approvals and the dev reviewer's tuples."""
        if not self.demo:
            return
        tenant = current_tenant().tenant_id
        with self._lock:
            if tenant in self._seeded:
                return
            self._seeded.add(tenant)
        t = f"tenant:{tenant}"
        self.fga.write_tuples([TupleKey(f"user:{DEV_ADMIN}", "admin", t), TupleKey(f"user:{DEV_MEMBER}", "member", "project:prj-phoenix"),
                               TupleKey(t, "parent", "project:prj-phoenix"), TupleKey(t, "parent", "project:prj-studio8")], [])
        seeds = [
            ("dec-001", "prj-phoenix", "Approve facade specification change for Tower B", "Upgraded acoustic glazing.", 0.95, True),
            ("dec-002", "prj-phoenix", "HVAC chiller unit substitution", "Voltas alternate in 4 weeks vs 16.", 0.64, False),
            ("dec-003", "prj-studio8", "Reject additional marble scope in lobby", "Keep vitrified tiles.", 0.88, False),
        ]
        for did, project, title, desc, conf, confirm in seeds:
            self.fga.write_tuples([TupleKey(f"project:{project}", "parent", f"decision:{did}")], [])
            self.decisions.propose(decision_id=did, project_id=project, title=title, description=desc,
                                   evidence_ids=(f"ev_{did}",), confidence=conf, source_ref="demo")
            if confirm and self.decisions.get(did).status is DecisionStatus.PROPOSED:  # idempotent across restarts
                self.decisions.confirm(did, DEV_ADMIN, "demo seed")
        if self.approvals.list():
            return  # already seeded (a restart against a persistent database)
        self.approvals.request(kind=ApprovalKind.DRAFT_MESSAGE, title="Chase RA bill 14", body="Dear team ...",
                               requested_by="agent:project_manager", requested_via=RequestedVia.AGENT,
                               reason="RA bill 14 is 12 days overdue", evidence_ids=("ev_dec-001",), project_id="prj-phoenix")
