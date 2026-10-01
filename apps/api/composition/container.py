# Owner task: EB-53 Decision Memory · EB-66 Approval model (API wiring)
"""Service container: the domain services handlers use, built once per app.

Everything here is tenant-scoped by the services themselves (they read the active TenantContext), so handlers
never pass a tenant id around. Production swaps the in-memory stores for Postgres-backed ones behind the same
interfaces; permissions go through OpenFGA via ``PermissionsClient``.

Demo data is seeded lazily per tenant and ONLY in development auth mode, so a production container starts empty.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

from apps.api.audit import AuditEvent, InMemoryAuditWriter
from decision_memory import Decision, DecisionMemory
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
    audit: InMemoryAuditWriter
    demo: bool = False
    finance_executor: Callable[..., Any] | None = None  # reviewed-SQL executor; None until the DB is wired
    _seeded: set[str] = field(default_factory=set)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    @classmethod
    def in_memory(cls, *, demo: bool = False) -> "Services":
        audit = InMemoryAuditWriter()
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
            decisions=DecisionMemory(can_review=can_review_decision, audit=lambda **kw: write_audit(**kw)),
            approvals=ApprovalService(InMemoryApprovalStore(), can_decide=can_decide_approval, audit=write_audit),
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
            if confirm:
                self.decisions.confirm(did, DEV_ADMIN, "demo seed")
        self.approvals.request(kind=ApprovalKind.DRAFT_MESSAGE, title="Chase RA bill 14", body="Dear team ...",
                               requested_by="agent:project_manager", requested_via=RequestedVia.AGENT,
                               reason="RA bill 14 is 12 days overdue", evidence_ids=("ev_dec-001",), project_id="prj-phoenix")
