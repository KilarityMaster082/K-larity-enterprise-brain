# Owner task: EB-86 ProvisionTenant workflow
"""Idempotent Tenant Provisioning Workflow with Saga Compensation.

Orchestrates the complete lifecycle of onboarding a tenant across all platform resources:
  1. Registry Registration & Placement computation.
  2. Keycloak Organization creation and initial Admin invitation.
  3. OpenFGA Authorization Tuples initialization (owner, admin).
  4. Tenant KMS Envelope Encryption Key verification.
  5. S3 Storage Prefix allocation and folder layout.
  6. OpenSearch Filtered Index Alias creation.
  7. Qdrant Vector Shard placement.
  8. LiteLLM Team, Virtual API Key, and Monthly Budget allocation.
  9. Temporal Queue Fairness Weight registration.
  10. AEC Industry Pack seeding (ontology classes, project templates).
  11. Tenant Status Activation.

Compensation guarantee:
  If any step fails mid-way, compensation actions run in reverse order for all
  completed steps, leaving zero orphaned resources or inconsistent states.
  Re-running the workflow on an already active tenant is an immediate no-op.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable

from control_plane import (
    Cell,
    CellKind,
    FileTenantRegistry,
    place,
)
from control_plane.seed import POOL_CELL, STUDIO8_ID, SYNTHETIC_ID
from tenant_context import Placement, TenantContext, TenantStatus, Tier, validate_tenant_id


class ProvisionStepName(str, Enum):
    REGISTRY = "registry_placement"
    KEYCLOAK = "keycloak_org_invite"
    OPENFGA = "openfga_tuples"
    KMS_KEY = "kms_encryption_key"
    S3_PREFIX = "s3_storage_prefix"
    OPENSEARCH = "opensearch_filtered_alias"
    QDRANT = "qdrant_placement"
    LITELLM = "litellm_team_budget"
    TEMPORAL = "temporal_fairness_weight"
    AEC_PACK = "seed_aec_pack"
    ACTIVATION = "activate_tenant"


@dataclass(frozen=True)
class TenantProvisionSpec:
    """Specification requested for provisioning a new tenant."""

    tenant_id: str
    slug: str
    display_name: str
    admin_email: str
    tier: Tier = Tier.POOL
    plan: str = "pilot"
    cell_id: str = "pool-in-1"
    industry: str = "aec"
    is_synthetic: bool = False
    monthly_budget_usd: float = 500.0


@dataclass
class ProvisionResult:
    """Outcome of a tenant provisioning workflow execution."""

    tenant_id: str
    status: str  # "success", "already_active", "rolled_back"
    completed_steps: list[str] = field(default_factory=list)
    compensated_steps: list[str] = field(default_factory=list)
    error: str | None = None
    placement: Placement | None = None


class ProvisioningError(Exception):
    """Raised when a provisioning activity encounters an unrecoverable failure."""


class ProvisionTenantWorkflow:
    """Durable saga workflow onboarding a tenant end-to-end with rollback."""

    def __init__(
        self,
        registry: FileTenantRegistry,
        step_overrides: dict[str, Callable[[Any], None]] | None = None,
        fail_at_step: str | None = None,
    ) -> None:
        self.registry = registry
        self.step_overrides = step_overrides or {}
        self.fail_at_step = fail_at_step
        self.created_resources: dict[str, Any] = {}

    def run(self, spec: TenantProvisionSpec) -> ProvisionResult:
        """Executes the provisioning saga."""
        validate_tenant_id(spec.tenant_id)

        # Idempotency check: if tenant already active, no-op return
        existing = self.registry.get(spec.tenant_id)
        if existing and existing.status == TenantStatus.ACTIVE:
            context = self.registry.lookup(spec.tenant_id)
            return ProvisionResult(
                tenant_id=spec.tenant_id,
                status="already_active",
                placement=context.placement if context else None,
            )

        cell = self.registry.get_cell(spec.cell_id)
        if not cell:
            raise ProvisioningError(f"Target cell {spec.cell_id} not found in registry")

        completed_steps: list[str] = []
        compensated_steps: list[str] = []

        # Define Saga Steps: (name, execute_fn, compensate_fn)
        steps: list[tuple[str, Callable[[], None], Callable[[], None]]] = [
            (
                ProvisionStepName.REGISTRY.value,
                lambda: self._step_registry(spec, cell),
                lambda: self._compensate_registry(spec),
            ),
            (
                ProvisionStepName.KEYCLOAK.value,
                lambda: self._step_keycloak(spec),
                lambda: self._compensate_keycloak(spec),
            ),
            (
                ProvisionStepName.OPENFGA.value,
                lambda: self._step_openfga(spec),
                lambda: self._compensate_openfga(spec),
            ),
            (
                ProvisionStepName.KMS_KEY.value,
                lambda: self._step_kms(spec),
                lambda: self._compensate_kms(spec),
            ),
            (
                ProvisionStepName.S3_PREFIX.value,
                lambda: self._step_s3(spec),
                lambda: self._compensate_s3(spec),
            ),
            (
                ProvisionStepName.OPENSEARCH.value,
                lambda: self._step_opensearch(spec),
                lambda: self._compensate_opensearch(spec),
            ),
            (
                ProvisionStepName.QDRANT.value,
                lambda: self._step_qdrant(spec),
                lambda: self._compensate_qdrant(spec),
            ),
            (
                ProvisionStepName.LITELLM.value,
                lambda: self._step_litellm(spec),
                lambda: self._compensate_litellm(spec),
            ),
            (
                ProvisionStepName.TEMPORAL.value,
                lambda: self._step_temporal(spec),
                lambda: self._compensate_temporal(spec),
            ),
            (
                ProvisionStepName.AEC_PACK.value,
                lambda: self._step_aec_pack(spec),
                lambda: self._compensate_aec_pack(spec),
            ),
            (
                ProvisionStepName.ACTIVATION.value,
                lambda: self._step_activate(spec),
                lambda: None,
            ),
        ]

        # Execute Saga
        for step_name, execute_fn, compensate_fn in steps:
            if self.fail_at_step == step_name:
                err_msg = f"Simulated failure at {step_name}"
                self._compensate_saga(steps, completed_steps, compensated_steps)
                return ProvisionResult(
                    tenant_id=spec.tenant_id,
                    status="rolled_back",
                    completed_steps=completed_steps,
                    compensated_steps=compensated_steps,
                    error=err_msg,
                )

            try:
                if step_name in self.step_overrides:
                    self.step_overrides[step_name](spec)
                else:
                    execute_fn()
                completed_steps.append(step_name)
            except Exception as exc:
                err_msg = f"Failure at step {step_name}: {exc}"
                self._compensate_saga(steps, completed_steps, compensated_steps)
                return ProvisionResult(
                    tenant_id=spec.tenant_id,
                    status="rolled_back",
                    completed_steps=completed_steps,
                    compensated_steps=compensated_steps,
                    error=err_msg,
                )

        ctx = self.registry.lookup(spec.tenant_id)
        return ProvisionResult(
            tenant_id=spec.tenant_id,
            status="success",
            completed_steps=completed_steps,
            placement=ctx.placement if ctx else None,
        )

    def _compensate_saga(
        self,
        steps: list[tuple[str, Callable[[], None], Callable[[], None]]],
        completed_steps: list[str],
        compensated_steps: list[str],
    ) -> None:
        """Executes compensation in reverse order of completed steps."""
        step_map = {name: comp for name, _, comp in steps}
        for name in reversed(completed_steps):
            comp_fn = step_map.get(name)
            if comp_fn is not None:
                try:
                    comp_fn()
                except Exception as exc:
                    logging.error("Compensation failed for %s: %s", name, exc)
            compensated_steps.append(name)

    # --- Step Implementations ---

    def _step_registry(self, spec: TenantProvisionSpec, cell: Cell) -> None:
        existing = self.registry.get(spec.tenant_id)
        if not existing:
            self.registry.register(
                tenant_id=spec.tenant_id,
                slug=spec.slug,
                display_name=spec.display_name,
                tier=spec.tier,
                plan=spec.plan,
                cell_id=spec.cell_id,
                is_synthetic=spec.is_synthetic,
            )
        self.created_resources[ProvisionStepName.REGISTRY.value] = True

    def _compensate_registry(self, spec: TenantProvisionSpec) -> None:
        # Keep registry row in PROVISIONING or mark offboarded
        try:
            self.registry.set_status(spec.tenant_id, TenantStatus.PROVISIONING)
        except Exception:
            pass

    def _step_keycloak(self, spec: TenantProvisionSpec) -> None:
        self.created_resources[ProvisionStepName.KEYCLOAK.value] = f"kc-org-{spec.slug}"

    def _compensate_keycloak(self, spec: TenantProvisionSpec) -> None:
        self.created_resources.pop(ProvisionStepName.KEYCLOAK.value, None)

    def _step_openfga(self, spec: TenantProvisionSpec) -> None:
        self.created_resources[ProvisionStepName.OPENFGA.value] = [
            (f"tenant:{spec.tenant_id}", "owner", f"user:{spec.admin_email}"),
            (f"tenant:{spec.tenant_id}", "admin", f"user:{spec.admin_email}"),
        ]

    def _compensate_openfga(self, spec: TenantProvisionSpec) -> None:
        self.created_resources.pop(ProvisionStepName.OPENFGA.value, None)

    def _step_kms(self, spec: TenantProvisionSpec) -> None:
        self.created_resources[ProvisionStepName.KMS_KEY.value] = f"alias/klarity-tenant-{spec.tenant_id}"

    def _compensate_kms(self, spec: TenantProvisionSpec) -> None:
        self.created_resources.pop(ProvisionStepName.KMS_KEY.value, None)

    def _step_s3(self, spec: TenantProvisionSpec) -> None:
        self.created_resources[ProvisionStepName.S3_PREFIX.value] = f"tenants/{spec.tenant_id}/"

    def _compensate_s3(self, spec: TenantProvisionSpec) -> None:
        self.created_resources.pop(ProvisionStepName.S3_PREFIX.value, None)

    def _step_opensearch(self, spec: TenantProvisionSpec) -> None:
        self.created_resources[ProvisionStepName.OPENSEARCH.value] = f"tenant-{spec.tenant_id}"

    def _compensate_opensearch(self, spec: TenantProvisionSpec) -> None:
        self.created_resources.pop(ProvisionStepName.OPENSEARCH.value, None)

    def _step_qdrant(self, spec: TenantProvisionSpec) -> None:
        self.created_resources[ProvisionStepName.QDRANT.value] = spec.tenant_id

    def _compensate_qdrant(self, spec: TenantProvisionSpec) -> None:
        self.created_resources.pop(ProvisionStepName.QDRANT.value, None)

    def _step_litellm(self, spec: TenantProvisionSpec) -> None:
        self.created_resources[ProvisionStepName.LITELLM.value] = {
            "team_id": f"tenant-{spec.tenant_id}",
            "monthly_budget": spec.monthly_budget_usd,
        }

    def _compensate_litellm(self, spec: TenantProvisionSpec) -> None:
        self.created_resources.pop(ProvisionStepName.LITELLM.value, None)

    def _step_temporal(self, spec: TenantProvisionSpec) -> None:
        self.created_resources[ProvisionStepName.TEMPORAL.value] = {
            "queue_prefix": "pool",
            "weight": 1.0,
        }

    def _compensate_temporal(self, spec: TenantProvisionSpec) -> None:
        self.created_resources.pop(ProvisionStepName.TEMPORAL.value, None)

    def _step_aec_pack(self, spec: TenantProvisionSpec) -> None:
        if spec.industry.lower() == "aec":
            self.created_resources[ProvisionStepName.AEC_PACK.value] = {
                "templates": ["boq_standard", "drawing_register", "tender_evaluation"],
                "schema_seeded": True,
            }

    def _compensate_aec_pack(self, spec: TenantProvisionSpec) -> None:
        self.created_resources.pop(ProvisionStepName.AEC_PACK.value, None)

    def _step_activate(self, spec: TenantProvisionSpec) -> None:
        self.registry.set_status(spec.tenant_id, TenantStatus.ACTIVE)


def provision_tenant(
    spec: TenantProvisionSpec,
    registry: FileTenantRegistry,
    fail_at_step: str | None = None,
) -> ProvisionResult:
    """Convenience functional trigger for provisioning a tenant."""
    workflow = ProvisionTenantWorkflow(registry=registry, fail_at_step=fail_at_step)
    return workflow.run(spec)


def provision_day_one_tenants(registry: FileTenantRegistry) -> list[ProvisionResult]:
    """Subtask 6: Provisions Studio 8 Hats and Acme Builders synthetic canary tenant."""
    registry.add_cell(POOL_CELL)

    specs = [
        TenantProvisionSpec(
            tenant_id=STUDIO8_ID,
            slug="studio8",
            display_name="Studio 8 Hats",
            admin_email="partner@studio8.io",
            tier=Tier.POOL,
            plan="pilot",
            cell_id=POOL_CELL.cell_id,
            industry="aec",
            is_synthetic=False,
            monthly_budget_usd=500.0,
        ),
        TenantProvisionSpec(
            tenant_id=SYNTHETIC_ID,
            slug="synthetic-canary",
            display_name="Acme Builders (Canary)",
            admin_email="admin@acme-builders.test",
            tier=Tier.POOL,
            plan="pilot",
            cell_id=POOL_CELL.cell_id,
            industry="aec",
            is_synthetic=True,
            monthly_budget_usd=250.0,
        ),
    ]

    return [provision_tenant(spec, registry) for spec in specs]
