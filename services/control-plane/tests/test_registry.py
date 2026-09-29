"""Owner task: EB-85 Tenant registry and control plane — registry, placement and end-to-end isolation tests."""

from __future__ import annotations

import re
from dataclasses import replace
from pathlib import Path

import pytest

from control_plane import (
    Cell,
    CellKind,
    FileTenantRegistry,
    InvalidTransitionError,
    RegistryConflictError,
    RegistryError,
    place,
)
from control_plane.seed import DAY_ONE_TENANTS, POOL_CELL, STUDIO8_ID, SYNTHETIC_ID, seed
from storage import LocalObjectBackend, ObjectStore
from tenant_context import (
    NoTenantContextError,
    PlacementResolver,
    TenantStatus,
    TenantUnavailableError,
    Tier,
)

REPO = Path(__file__).resolve().parents[3]
SILO_CELL = replace(POOL_CELL, cell_id="silo-in-1", kind=CellKind.DEDICATED, object_bucket="klarity-silo-in-1")


@pytest.fixture
def reg(tmp_path):
    return FileTenantRegistry(tmp_path / "registry.json")


# -- day-one tenants (acceptance: Studio 8 + synthetic test tenant) -----------------------------------------
def test_seed_registers_both_tenants_idempotently(reg):
    first = seed(reg)
    assert [t.status for t in first] == [TenantStatus.PROVISIONING] * 2
    seed(reg)  # a re-run is a no-op
    active = seed(reg, activate=True)
    assert {t.slug: t.status for t in active} == {"studio8": TenantStatus.ACTIVE,
                                                  "synthetic-canary": TenantStatus.ACTIVE}
    assert [t.is_synthetic for t in reg.list()] == [False, True]
    assert all(t.tier is Tier.POOL and t.region == "ap-south-2" for t in reg.list())


def test_sql_seed_matches_code_seed():
    sql = (REPO / "db/seed/tenants.sql").read_text()
    for spec in DAY_ONE_TENANTS:
        assert re.search(rf"'{spec['tenant_id']}',\s*'{spec['slug']}'", sql), spec["slug"]
    assert f"'{POOL_CELL.cell_id}'" in sql and f"'{POOL_CELL.region}'" in sql


# -- placement ---------------------------------------------------------------------------------------------
def test_pool_and_bridge_placement():
    pool = place("tenant-a", Tier.POOL, POOL_CELL)
    bridge = place("tenant-b", Tier.BRIDGE, POOL_CELL)
    assert (pool.pg_database, pool.qdrant_shard_key, pool.opensearch_index, pool.temporal_queue_prefix) == \
        ("brain", "pool", "docs", "pool")
    assert (bridge.pg_database, bridge.qdrant_shard_key, bridge.opensearch_index, bridge.temporal_queue_prefix) \
        == ("brain_tenant_b", "tenant-b", "docs-tenant-b", "t-tenant-b")
    for p, t in ((pool, "tenant-a"), (bridge, "tenant-b")):
        assert p.object_prefix == f"tenants/{t}/" and p.opensearch_alias == f"tenant-{t}"
        assert p.litellm_team == f"tenant-{t}" and p.kms_key_ref == f"alias/klarity-tenant-{t}"


def test_tier_must_match_cell_kind():
    with pytest.raises(ValueError):
        place("tenant-a", Tier.SILO, POOL_CELL)
    with pytest.raises(ValueError):
        place("tenant-a", Tier.POOL, SILO_CELL)
    assert place("tenant-a", Tier.SILO, SILO_CELL).qdrant_shard_key == "tenant-a"


def test_no_two_tenants_share_a_per_tenant_resource(reg):
    seed(reg)
    a, b = (reg.lookup(t).placement for t in (STUDIO8_ID, SYNTHETIC_ID))
    for kind in ("object_prefix", "opensearch_alias", "litellm_team", "kms_key_ref"):
        assert getattr(a, kind) != getattr(b, kind), kind


# -- registry rules ----------------------------------------------------------------------------------------
def test_conflicting_registrations_are_refused(reg):
    seed(reg)
    spec = dict(DAY_ONE_TENANTS[0])
    with pytest.raises(RegistryConflictError):
        reg.register(**{**spec, "tier": Tier.BRIDGE})
    with pytest.raises(RegistryConflictError):
        reg.register(**{**spec, "tenant_id": "another-tenant"})  # slug taken
    with pytest.raises(RegistryError):
        reg.register(**{**spec, "tenant_id": "another-tenant", "slug": "another", "cell_id": "nope"})
    with pytest.raises(RegistryConflictError):
        reg.add_cell(replace(POOL_CELL, region="ap-south-1"))


def test_dedicated_cell_holds_one_tenant(reg):
    reg.add_cell(SILO_CELL)
    reg.register(tenant_id="bigco", slug="bigco", display_name="BigCo", tier=Tier.SILO, plan="enterprise",
                 cell_id=SILO_CELL.cell_id)
    with pytest.raises(RegistryConflictError):
        reg.register(tenant_id="otherco", slug="otherco", display_name="OtherCo", tier=Tier.SILO,
                     plan="enterprise", cell_id=SILO_CELL.cell_id)


def test_status_transitions(reg):
    seed(reg)
    with pytest.raises(InvalidTransitionError):
        reg.set_status(STUDIO8_ID, TenantStatus.SUSPENDED)  # provisioning -> suspended
    for s in (TenantStatus.ACTIVE, TenantStatus.SUSPENDED, TenantStatus.ACTIVE,
              TenantStatus.OFFBOARDING, TenantStatus.OFFBOARDED):
        assert reg.set_status(STUDIO8_ID, s).status is s
    with pytest.raises(InvalidTransitionError):
        reg.set_status(STUDIO8_ID, TenantStatus.ACTIVE)  # offboarded is terminal


def test_resources_set_during_provisioning(reg):
    seed(reg)
    reg.set_resource(STUDIO8_ID, "keycloak_org_id", "kc-org-123")
    assert reg.lookup(STUDIO8_ID).placement.keycloak_org_id == "kc-org-123"
    for kind in ("object_prefix", "cell_id", "region"):
        with pytest.raises(RegistryError):
            reg.set_resource(STUDIO8_ID, kind, "tenants/" + SYNTHETIC_ID + "/")
    with pytest.raises(RegistryError):
        reg.set_resource(STUDIO8_ID, "not_a_kind", "x")


# -- end to end: store placement comes from the registry ---------------------------------------------------
def test_store_reads_placement_from_registry_and_canary_does_not_leak(reg, tmp_path):
    seed(reg, activate=True)
    resolver = PlacementResolver(reg)
    store = ObjectStore(LocalObjectBackend(tmp_path / "objects"))
    canary = b"CANARY-7f3e synthetic tenant secret"

    with resolver.scope(SYNTHETIC_ID):
        store.put("raw/canary.txt", canary)
    with resolver.scope(STUDIO8_ID):
        store.put("raw/doc.txt", b"studio 8 doc")
        assert store.list() == ["raw/doc.txt"]
        assert not store.exists("raw/canary.txt")

    bucket = tmp_path / "objects" / POOL_CELL.object_bucket
    assert (bucket / f"tenants/{SYNTHETIC_ID}/raw/canary.txt").read_bytes() == canary
    studio8_bytes = b"".join(f.read_bytes() for f in (bucket / f"tenants/{STUDIO8_ID}").rglob("*") if f.is_file())
    assert b"CANARY-7f3e" not in studio8_bytes

    with pytest.raises(NoTenantContextError):
        store.list()


def test_suspended_tenant_stops_resolving(reg):
    seed(reg, activate=True)
    resolver = PlacementResolver(reg)
    resolver.resolve(STUDIO8_ID)
    reg.set_status(STUDIO8_ID, TenantStatus.SUSPENDED)
    resolver.invalidate(STUDIO8_ID)
    with pytest.raises(TenantUnavailableError):
        resolver.resolve(STUDIO8_ID)
