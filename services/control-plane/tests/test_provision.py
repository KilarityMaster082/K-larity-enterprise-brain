# Owner task: EB-86 ProvisionTenant workflow
"""Unit tests for ProvisionTenant workflow, idempotency, saga compensation, and day-one tenants."""

from __future__ import annotations

from typing import Any
import pytest

from control_plane import (
    Cell,
    CellKind,
    FileTenantRegistry,
)
from control_plane.seed import POOL_CELL, STUDIO8_ID, SYNTHETIC_ID
import importlib.util
from pathlib import Path

_provision_path = Path(__file__).resolve().parents[1] / "workflows" / "provision.py"
_spec = importlib.util.spec_from_file_location("control_plane_provision", str(_provision_path))
_mod = importlib.util.module_from_spec(_spec)
import sys
sys.modules["control_plane_provision"] = _mod
_spec.loader.exec_module(_mod)

ProvisionResult = _mod.ProvisionResult
ProvisionStepName = _mod.ProvisionStepName
ProvisionTenantWorkflow = _mod.ProvisionTenantWorkflow
TenantProvisionSpec = _mod.TenantProvisionSpec
provision_day_one_tenants = _mod.provision_day_one_tenants
provision_tenant = _mod.provision_tenant
from tenant_context import TenantStatus, Tier


@pytest.fixture
def reg(tmp_path: Any) -> FileTenantRegistry:
    r = FileTenantRegistry(tmp_path / "registry.json")
    r.add_cell(POOL_CELL)
    return r


def test_provision_tenant_end_to_end(reg: FileTenantRegistry) -> None:
    """Subtasks 1-4: Complete provisioning of a new tenant through all steps."""
    spec = TenantProvisionSpec(
        tenant_id="new-tenant-1",
        slug="new-tenant-1",
        display_name="New Test Tenant",
        admin_email="admin@test.com",
        tier=Tier.POOL,
        plan="pilot",
        cell_id=POOL_CELL.cell_id,
        industry="aec",
        monthly_budget_usd=500.0,
    )

    res = provision_tenant(spec, reg)

    assert res.status == "success"
    assert len(res.completed_steps) == 11
    assert res.placement is not None
    assert res.placement.cell_id == "pool-in-1"
    assert res.placement.object_prefix == "tenants/new-tenant-1/"

    # Verify tenant in registry
    tenant = reg.get("new-tenant-1")
    assert tenant is not None
    assert tenant.status == TenantStatus.ACTIVE


def test_provision_tenant_idempotent_rerun(reg: FileTenantRegistry) -> None:
    """Subtask 7: Acceptance criterion: re-running the workflow is a no-op."""
    spec = TenantProvisionSpec(
        tenant_id="idempotent-tenant",
        slug="idempotent-tenant",
        display_name="Idempotent Tenant",
        admin_email="admin@idempotent.test",
        cell_id=POOL_CELL.cell_id,
    )

    # First run: success
    res1 = provision_tenant(spec, reg)
    assert res1.status == "success"

    # Second run: immediate no-op
    res2 = provision_tenant(spec, reg)
    assert res2.status == "already_active"
    assert res2.placement is not None
    assert res2.placement.cell_id == "pool-in-1"


def test_provision_tenant_midway_failure_compensates(reg: FileTenantRegistry) -> None:
    """Subtask 7: Acceptance criterion: mid-way failure rolls back cleanly."""
    spec = TenantProvisionSpec(
        tenant_id="rollback-tenant",
        slug="rollback-tenant",
        display_name="Rollback Tenant",
        admin_email="admin@rollback.test",
        cell_id=POOL_CELL.cell_id,
    )

    # Simulate failure at opensearch step
    res = provision_tenant(spec, reg, fail_at_step=ProvisionStepName.OPENSEARCH.value)

    assert res.status == "rolled_back"
    assert "Simulated failure at opensearch_filtered_alias" in str(res.error)
    # Check that prior completed steps were compensated in reverse
    assert ProvisionStepName.S3_PREFIX.value in res.compensated_steps
    assert ProvisionStepName.KMS_KEY.value in res.compensated_steps
    assert ProvisionStepName.OPENFGA.value in res.compensated_steps
    assert ProvisionStepName.KEYCLOAK.value in res.compensated_steps

    # Tenant must NOT be active
    tenant = reg.get("rollback-tenant")
    assert tenant is not None
    assert tenant.status != TenantStatus.ACTIVE


def test_provision_day_one_tenants(reg: FileTenantRegistry) -> None:
    """Subtask 6: Provision Studio 8 Hats + synthetic canary tenant."""
    results = provision_day_one_tenants(reg)

    assert len(results) == 2
    assert results[0].status == "success"
    assert results[1].status == "success"

    # Verify both tenants active
    s8 = reg.get(STUDIO8_ID)
    canary = reg.get(SYNTHETIC_ID)
    assert s8 is not None and s8.status == TenantStatus.ACTIVE and not s8.is_synthetic
    assert canary is not None and canary.status == TenantStatus.ACTIVE and canary.is_synthetic
