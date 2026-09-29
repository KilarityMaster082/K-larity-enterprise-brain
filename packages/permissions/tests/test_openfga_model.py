# Owner task: EB-22 OpenFGA authorization model and tuple sync
"""Unit and integration tests for OpenFGA authorization model and tuple sync."""

from __future__ import annotations

from pathlib import Path
from typing import Any
import pytest

from packages.permissions import PermissionsClient, TupleSynchronizer
from storage import FgaStore, LocalFgaBackend
from tenant_context import (
    NoTenantContextError,
    Placement,
    TenantContext,
    TenantStatus,
    Tier,
    tenant_scope,
)


def _make_ctx(tenant_id: str) -> TenantContext:
    p = Placement(
        cell_id="c1",
        region="ap-south-2",
        pg_cluster="pg",
        pg_database="brain",
        object_bucket="klarity-pool-bucket",
        object_prefix=f"tenants/{tenant_id}/",
        qdrant_cluster="q",
        qdrant_shard_key=tenant_id,
        opensearch_cluster="os",
        opensearch_index=f"klarity-{tenant_id}",
        opensearch_alias="klarity-pool-alias",
        fga_store=f"fga-{tenant_id}",
        temporal_namespace="c1",
        temporal_queue_prefix="pool",
        litellm_team=f"tenant-{tenant_id}",
        kms_key_ref=f"alias/klarity-tenant-{tenant_id}",
    )
    return TenantContext(
        tenant_id=tenant_id,
        slug=tenant_id,
        status=TenantStatus.ACTIVE,
        tier=Tier.POOL,
        placement=p,
    )


@pytest.fixture
def tenant_studio8() -> TenantContext:
    return _make_ctx("studio8")


def test_model_fga_syntax() -> None:
    """Verify packages/permissions/model.fga exists and contains required relation types."""
    fga_path = Path(__file__).resolve().parents[1] / "model.fga"
    assert fga_path.exists(), "model.fga must exist"
    text = fga_path.read_text(encoding="utf-8")
    assert "schema 1.1" in text
    assert "type tenant" in text
    assert "type project" in text
    assert "type document" in text
    assert "type financial_record" in text
    assert "type decision" in text


def test_fga_store_requires_tenant_context() -> None:
    backend = LocalFgaBackend()
    store = FgaStore(backend)

    with pytest.raises(NoTenantContextError):
        store.check("user:u1", "viewer", "project:p1")

    with pytest.raises(NoTenantContextError):
        store.list_objects("user:u1", "viewer", "project")


def test_project_membership_and_isolation(tenant_studio8: TenantContext) -> None:
    """Acceptance criterion: Staff sees only assigned projects."""
    backend = LocalFgaBackend()
    store = FgaStore(backend)
    client = PermissionsClient(store)
    sync = TupleSynchronizer(store)

    with tenant_scope(tenant_studio8):
        # 1. Sync tenant roles
        sync.sync_tenant_roles(
            tenant_id="studio8",
            admins=["alice"],
            finance_viewers=["bob"],
            members=["charlie", "david"],
        )

        # 2. Sync projects
        sync.sync_project("studio8", "metro-tower", lead_id="charlie", member_ids=["david"])
        sync.sync_project("studio8", "seaside-resort", lead_id="charlie", member_ids=[])

        # Staff David sees only assigned project (metro-tower)
        assert client.can_view_project("david", "metro-tower") is True
        assert client.can_edit_project("david", "metro-tower") is False
        assert client.can_view_project("david", "seaside-resort") is False

        # Lead Charlie can view and edit both
        assert client.can_view_project("charlie", "metro-tower") is True
        assert client.can_edit_project("charlie", "metro-tower") is True
        assert client.can_view_project("charlie", "seaside-resort") is True

        # Tenant Admin Alice can view and edit all projects
        assert client.can_view_project("alice", "metro-tower") is True
        assert client.can_edit_project("alice", "metro-tower") is True
        assert client.can_view_project("alice", "seaside-resort") is True

        # List accessible projects for David
        david_projects = client.list_accessible_projects("david")
        assert david_projects == ["metro-tower"]


def test_financial_records_protection(tenant_studio8: TenantContext) -> None:
    """Acceptance criterion: finance data needs finance_viewer."""
    backend = LocalFgaBackend()
    store = FgaStore(backend)
    client = PermissionsClient(store)
    sync = TupleSynchronizer(store)

    with tenant_scope(tenant_studio8):
        sync.sync_tenant_roles(
            tenant_id="studio8",
            admins=["alice"],
            finance_viewers=["bob"],
            members=["charlie", "david"],
        )
        sync.sync_project("studio8", "metro-tower", lead_id="charlie", member_ids=["david"])
        sync.sync_financial_record("metro-tower", "q3-audit")

        # Regular staff (David) is blocked from financial record
        assert client.can_view_finance("david", "metro-tower", "q3-audit") is False

        # Finance viewer (Bob) can view financial record
        assert client.can_view_finance("bob", "metro-tower", "q3-audit") is True

        # Tenant Admin (Alice) can view and edit financial record
        assert client.can_view_finance("alice", "metro-tower", "q3-audit") is True


def test_decision_and_document_workflow(tenant_studio8: TenantContext) -> None:
    backend = LocalFgaBackend()
    store = FgaStore(backend)
    client = PermissionsClient(store)
    sync = TupleSynchronizer(store)

    with tenant_scope(tenant_studio8):
        sync.sync_tenant_roles("studio8", admins=["alice"], members=["charlie", "david"])
        sync.sync_project("studio8", "metro-tower", lead_id="charlie", member_ids=["david"])
        sync.sync_document("metro-tower", "spec-doc-1")
        sync.sync_decision("metro-tower", "facade-change")

        # Document view
        assert client.can_view_document("david", "spec-doc-1") is True
        assert client.can_edit_document("david", "spec-doc-1") is False
        assert client.can_edit_document("charlie", "spec-doc-1") is True

        # Decision review
        assert client.can_review_decision("david", "facade-change") is False
        assert client.can_review_decision("charlie", "facade-change") is True
        assert client.can_review_decision("alice", "facade-change") is True


def test_check_cache_ttl_and_invalidation(tenant_studio8: TenantContext) -> None:
    """Subtask 5: Decide check cache TTL (15s) and invalidation upon writes."""
    backend = LocalFgaBackend()
    store = FgaStore(backend, cache_ttl_seconds=15.0)
    sync = TupleSynchronizer(store)

    with tenant_scope(tenant_studio8):
        sync.sync_tenant_roles("studio8", members=["david"])
        sync.sync_project("studio8", "proj-1", member_ids=[])

        # Check initially false
        assert store.check("user:david", "viewer", "project:proj-1") is False

        # Write tuple: should invalidate cache
        sync.sync_project("studio8", "proj-1", member_ids=["david"])

        # Check now reflects updated tuple immediately
        assert store.check("user:david", "viewer", "project:proj-1") is True
