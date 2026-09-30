# Owner task: EB-66 Approval model skeleton
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from packages.approvals import (
    ApprovalKind, ApprovalService, ApprovalStatus, InMemoryApprovalStore, InvalidTransitionError,
    NotAuthorizedError, NotFoundError, RequestedVia,
)
from tenant_context import Placement, TenantContext, TenantStatus, Tier, tenant_scope


def _ctx(tid: str) -> TenantContext:
    p = Placement(cell_id="c1", region="r", pg_cluster="pg", pg_database="d", object_bucket="b",
                  object_prefix=f"tenants/{tid}/", qdrant_cluster="q", qdrant_shard_key=tid, opensearch_cluster="o",
                  opensearch_index="i", opensearch_alias="a", fga_store=f"f-{tid}", temporal_namespace="c1",
                  temporal_queue_prefix="p", litellm_team=tid, kms_key_ref=tid)
    return TenantContext(tid, tid, TenantStatus.ACTIVE, Tier.POOL, p)


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 10, 1, tzinfo=timezone.utc)

    def __call__(self) -> datetime:
        return self.now


@pytest.fixture
def env():
    clock, audit = Clock(), []
    svc = ApprovalService(
        InMemoryApprovalStore(),
        can_decide=lambda user, req: user in {"asha", "ravi"},
        audit=lambda **kw: audit.append(kw),
        clock=clock,
    )
    return svc, clock, audit


def _new(svc, who="agent:pm", via=RequestedVia.AGENT):
    return svc.request(kind=ApprovalKind.DRAFT_MESSAGE, title="Chase RA bill", body="Hi...", requested_by=who,
                       requested_via=via, reason="RA bill 14 overdue", evidence_ids=("ev_1",), project_id="phoenix")


def test_happy_path_and_single_use(env) -> None:
    svc, _, audit = env
    with tenant_scope(_ctx("studio8")):
        a = _new(svc)
        assert a.status is ApprovalStatus.PENDING
        assert svc.approve(a.approval_id, "asha", "ok").status is ApprovalStatus.APPROVED
        assert svc.consume(a.approval_id, "agent:pm").status is ApprovalStatus.EXECUTED
        with pytest.raises(InvalidTransitionError):
            svc.consume(a.approval_id, "agent:pm")  # the side effect cannot run twice
    assert [e["action"] for e in audit] == ["approval.requested", "approval.approved", "approval.executed"]


def test_cannot_consume_unapproved_or_rejected(env) -> None:
    svc, _, _ = env
    with tenant_scope(_ctx("studio8")):
        a, b = _new(svc), _new(svc)
        with pytest.raises(InvalidTransitionError):
            svc.consume(a.approval_id, "agent:pm")
        svc.reject(b.approval_id, "ravi")
        with pytest.raises(InvalidTransitionError):
            svc.consume(b.approval_id, "agent:pm")


def test_separation_of_duties_and_authorization(env) -> None:
    svc, _, _ = env
    with tenant_scope(_ctx("studio8")):
        a = _new(svc, who="asha", via=RequestedVia.PERSON)
        with pytest.raises(NotAuthorizedError):
            svc.approve(a.approval_id, "asha")  # own request
        with pytest.raises(NotAuthorizedError):
            svc.approve(a.approval_id, "mallory")  # not permitted
        with pytest.raises(NotAuthorizedError):
            svc.approve(a.approval_id, "agent:pm")  # agents never decide
        assert svc.get(a.approval_id).status is ApprovalStatus.PENDING


def test_requires_reason_and_evidence(env) -> None:
    svc, _, _ = env
    with tenant_scope(_ctx("studio8")):
        with pytest.raises(ValueError):
            svc.request(kind=ApprovalKind.CREATE_TASK, title="t", body="b", requested_by="x",
                        requested_via=RequestedVia.AGENT, reason=" ", evidence_ids=("ev",))
        with pytest.raises(ValueError):
            svc.request(kind=ApprovalKind.CREATE_TASK, title="t", body="b", requested_by="x",
                        requested_via=RequestedVia.AGENT, reason="why", evidence_ids=())


def test_expiry_blocks_pending_and_approved(env) -> None:
    svc, clock, _ = env
    with tenant_scope(_ctx("studio8")):
        a, b = _new(svc), _new(svc)
        svc.approve(b.approval_id, "asha")
        clock.now += timedelta(hours=73)
        assert svc.get(a.approval_id).status is ApprovalStatus.EXPIRED
        with pytest.raises(InvalidTransitionError):
            svc.consume(b.approval_id, "agent:pm")  # approved but stale
        with pytest.raises(InvalidTransitionError):
            svc.approve(a.approval_id, "asha")


def test_only_requester_can_cancel(env) -> None:
    svc, _, _ = env
    with tenant_scope(_ctx("studio8")):
        a = _new(svc, who="priya", via=RequestedVia.PERSON)
        with pytest.raises(NotAuthorizedError):
            svc.cancel(a.approval_id, "asha")
        assert svc.cancel(a.approval_id, "priya").status is ApprovalStatus.CANCELLED


def test_tenant_isolation(env) -> None:
    svc, _, _ = env
    with tenant_scope(_ctx("studio8")):
        a = _new(svc)
    with tenant_scope(_ctx("other")):
        with pytest.raises(NotFoundError):
            svc.get(a.approval_id)
        with pytest.raises(NotFoundError):
            svc.approve(a.approval_id, "asha")
        assert svc.list() == []
    with tenant_scope(_ctx("studio8")):
        assert len(svc.list(ApprovalStatus.PENDING)) == 1


def test_wire_shape_matches_web_type(env) -> None:
    svc, _, _ = env
    with tenant_scope(_ctx("studio8")):
        d = _new(svc).to_dict()
    for key in ("approvalId", "kind", "title", "body", "requestedBy", "requestedVia", "requestedAt", "reason",
                "evidenceIds", "status", "projectId"):
        assert key in d
    assert d["status"] == "pending" and d["requestedVia"] == "agent"
