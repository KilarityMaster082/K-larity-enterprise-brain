"""Tenant registry: every tenant, its lifecycle status, and where its data lives.

Owner task: EB-85 Tenant registry and control plane
Borrowed from: Dify a4f949f api/models/account.py (pattern only, no code — licence bars multi-tenant use)
— tenant row with status and plan; Onyx ee tenant registry (pattern only, O11). Adapted: tier, cell and
region on the tenant; placement stored as tenant_resources rows (kind -> ref) and handed to the data
plane as a TenantContext through the TenantDirectory protocol; explicit status transitions.

Schema of record: db/control/schema.sql (control-plane database, no RLS, not reachable by the app role).
FileTenantRegistry is the development/test implementation; it re-reads the file on every call and writes
atomically. The Postgres implementation follows once the control database exists (EB-19 / deploy).
"""

from __future__ import annotations

import json
import os
import threading
from collections.abc import Callable
from dataclasses import asdict, dataclass, fields, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from tenant_context import Placement, TenantContext, TenantStatus, Tier, validate_tenant_id

from .placement import Cell, CellKind, place

S = TenantStatus
TRANSITIONS: dict[TenantStatus, frozenset[TenantStatus]] = {
    S.PROVISIONING: frozenset({S.ACTIVE, S.OFFBOARDING}),
    S.ACTIVE: frozenset({S.SUSPENDED, S.OFFBOARDING}),
    S.SUSPENDED: frozenset({S.ACTIVE, S.OFFBOARDING}),
    S.OFFBOARDING: frozenset({S.OFFBOARDED}),
    S.OFFBOARDED: frozenset(),
}
PLACEMENT_KINDS = frozenset(f.name for f in fields(Placement))
IMMUTABLE_KINDS = frozenset({"object_prefix", "cell_id", "region"})  # changing these is a migration, not an edit


class RegistryError(Exception):
    pass


class RegistryConflictError(RegistryError):
    """The request contradicts what the registry already holds."""


class InvalidTransitionError(RegistryError):
    pass


@dataclass(frozen=True)
class Tenant:
    tenant_id: str
    slug: str
    display_name: str
    tier: Tier
    plan: str
    cell_id: str
    region: str
    status: TenantStatus
    is_synthetic: bool
    created_at: str
    updated_at: str


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class FileTenantRegistry:
    """JSON-file registry for development and tests. Implements tenant_context.TenantDirectory."""

    def __init__(self, path: str | os.PathLike[str]) -> None:
        self.path = Path(path)
        self._lock = threading.Lock()

    # -- storage -----------------------------------------------------------------------------------------
    def _read(self) -> dict[str, Any]:
        if not self.path.exists():
            return {"cells": {}, "tenants": {}, "resources": {}}
        return json.loads(self.path.read_text())

    def _write(self, doc: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(self.path.name + ".tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(doc, sort_keys=True, indent=1))
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, self.path)

    @staticmethod
    def _tenant(d: dict[str, Any]) -> Tenant:
        return Tenant(**{**d, "tier": Tier(d["tier"]), "status": TenantStatus(d["status"])})

    @staticmethod
    def _tenant_dict(t: Tenant) -> dict[str, Any]:
        return {**asdict(t), "tier": t.tier.value, "status": t.status.value}

    # -- cells -------------------------------------------------------------------------------------------
    def add_cell(self, cell: Cell) -> Cell:
        with self._lock:
            doc = self._read()
            existing = doc["cells"].get(cell.cell_id)
            if existing is not None and Cell(**existing) != cell:
                raise RegistryConflictError(f"cell {cell.cell_id!r} already registered with different values")
            doc["cells"][cell.cell_id] = asdict(cell)
            self._write(doc)
            return cell

    def get_cell(self, cell_id: str) -> Cell | None:
        d = self._read()["cells"].get(cell_id)
        return Cell(**d) if d else None

    # -- tenants -----------------------------------------------------------------------------------------
    def register(self, *, tenant_id: str, slug: str, display_name: str, tier: Tier, plan: str, cell_id: str,
                 is_synthetic: bool = False) -> Tenant:
        """Create a tenant in PROVISIONING with its placement. Idempotent for an identical request."""
        validate_tenant_id(tenant_id)
        validate_tenant_id(slug)  # same shape rules: used in URLs and hostnames
        with self._lock:
            doc = self._read()
            cell_d = doc["cells"].get(cell_id)
            if cell_d is None:
                raise RegistryError(f"unknown cell {cell_id!r}")
            cell = Cell(**cell_d)
            existing = doc["tenants"].get(tenant_id)
            if existing is not None:
                t = self._tenant(existing)
                if (t.slug, t.tier, t.plan, t.cell_id, t.is_synthetic) != (slug, tier, plan, cell_id, is_synthetic):
                    raise RegistryConflictError(f"tenant {tenant_id!r} already registered with different values")
                return t
            if any(d["slug"] == slug for d in doc["tenants"].values()):
                raise RegistryConflictError(f"slug {slug!r} is taken")
            if cell.kind == CellKind.DEDICATED and any(
                    d["cell_id"] == cell_id and d["status"] != S.OFFBOARDED.value for d in doc["tenants"].values()):
                raise RegistryConflictError(f"dedicated cell {cell_id!r} already has a tenant")
            placement = place(tenant_id, tier, cell)
            now = _now()
            t = Tenant(tenant_id, slug, display_name, tier, plan, cell_id, cell.region, S.PROVISIONING,
                       is_synthetic, now, now)
            doc["tenants"][tenant_id] = self._tenant_dict(t)
            doc["resources"][tenant_id] = placement.to_resources()
            self._write(doc)
            return t

    def get(self, tenant_id: str) -> Tenant | None:
        d = self._read()["tenants"].get(tenant_id)
        return self._tenant(d) if d else None

    def list(self) -> list[Tenant]:
        return sorted((self._tenant(d) for d in self._read()["tenants"].values()), key=lambda t: t.slug)

    def set_status(self, tenant_id: str, status: TenantStatus) -> Tenant:
        with self._lock:
            doc = self._read()
            d = doc["tenants"].get(tenant_id)
            if d is None:
                raise RegistryError(f"unknown tenant {tenant_id!r}")
            t = self._tenant(d)
            if status == t.status:
                return t
            if status not in TRANSITIONS[t.status]:
                raise InvalidTransitionError(f"{t.status.value} -> {status.value} is not allowed")
            t = replace(t, status=status, updated_at=_now())
            doc["tenants"][tenant_id] = self._tenant_dict(t)
            self._write(doc)
            return t

    def set_resource(self, tenant_id: str, kind: str, ref: str) -> None:
        """Record a resource created during provisioning (e.g. keycloak_org_id)."""
        if kind not in PLACEMENT_KINDS:
            raise RegistryError(f"unknown resource kind {kind!r}")
        if kind in IMMUTABLE_KINDS:
            raise RegistryError(f"{kind} cannot be edited; moving a tenant is a migration")
        with self._lock:
            doc = self._read()
            if tenant_id not in doc["tenants"]:
                raise RegistryError(f"unknown tenant {tenant_id!r}")
            doc["resources"][tenant_id][kind] = ref
            self._write(doc)

    # -- TenantDirectory ---------------------------------------------------------------------------------
    def lookup(self, tenant_id: str) -> TenantContext | None:
        doc = self._read()
        d = doc["tenants"].get(tenant_id)
        if d is None:
            return None
        t = self._tenant(d)
        return TenantContext(t.tenant_id, t.slug, t.status, t.tier,
                             Placement.from_resources(doc["resources"][tenant_id]))


class PostgresTenantRegistry:
    """PostgreSQL implementation of the control-plane tenant registry (db/control/schema.sql).

    Uses a database connection or connection factory.
    """

    def __init__(self, connection_factory: Callable[[], Any]) -> None:
        self._conn_factory = connection_factory

    def add_cell(self, cell: Cell) -> None:
        with self._conn_factory() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO cells (cell_id, region, kind, pg_cluster, object_bucket, "
                    "qdrant_cluster, opensearch_cluster, fga_store, temporal_namespace) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) "
                    "ON CONFLICT (cell_id) DO NOTHING",
                    (cell.cell_id, cell.region, str(cell.kind), cell.pg_cluster,
                     cell.object_bucket, cell.qdrant_cluster, cell.opensearch_cluster,
                     cell.fga_store, cell.temporal_namespace),
                )
                if cur.rowcount == 0:
                    cur.execute("SELECT region, kind FROM cells WHERE cell_id = %s", (cell.cell_id,))
                    row = cur.fetchone()
                    if row and (row[0] != cell.region or row[1] != str(cell.kind)):
                        raise RegistryConflictError(f"cell {cell.cell_id!r} exists with different properties")
            if hasattr(conn, "commit"):
                conn.commit()

    def cell(self, cell_id: str) -> Cell:
        with self._conn_factory() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT cell_id, region, kind, pg_cluster, object_bucket, qdrant_cluster, "
                    "opensearch_cluster, fga_store, temporal_namespace FROM cells WHERE cell_id = %s",
                    (cell_id,),
                )
                row = cur.fetchone()
                if row is None:
                    raise RegistryError(f"unknown cell {cell_id!r}")
                cols = [desc[0] for desc in cur.description]
                d = dict(row) if isinstance(row, dict) else dict(zip(cols, row))
                return Cell(d["cell_id"], d["region"], d["kind"], d["pg_cluster"],
                            d["object_bucket"], d["qdrant_cluster"], d["opensearch_cluster"],
                            d["fga_store"], d["temporal_namespace"])

    def register(self, *, tenant_id: str, slug: str, display_name: str, tier: Tier,
                 plan: str, cell_id: str, is_synthetic: bool = False) -> Tenant:
        validate_tenant_id(tenant_id)
        validate_tenant_id(slug)
        c = self.cell(cell_id)
        if c.kind is CellKind.DEDICATED:
            with self._conn_factory() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT tenant_id FROM tenants WHERE cell_id = %s", (cell_id,))
                    row = cur.fetchone()
                    if row and row[0] != tenant_id:
                        raise RegistryConflictError(f"dedicated cell {cell_id!r} already holds tenant {row[0]!r}")
        placement = place(tenant_id, tier, c)
        now = _now()
        with self._conn_factory() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT tenant_id, slug, tier FROM tenants WHERE tenant_id = %s OR slug = %s",
                            (tenant_id, slug))
                existing = cur.fetchone()
                if existing:
                    ex_id, ex_slug, ex_tier = existing[0], existing[1], existing[2]
                    if ex_id == tenant_id:
                        if ex_slug == slug and ex_tier == tier.value:
                            return self.lookup_tenant(tenant_id)
                        raise RegistryConflictError(f"tenant {tenant_id!r} already exists with different properties")
                    raise RegistryConflictError(f"slug {slug!r} already taken by {ex_id!r}")

                cur.execute(
                    "INSERT INTO tenants (tenant_id, slug, display_name, status, tier, plan_id, "
                    "cell_id, region, is_synthetic, created_at, updated_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    (tenant_id, slug, display_name, TenantStatus.PROVISIONING.value, tier.value,
                     plan, cell_id, c.region, is_synthetic, now, now),
                )
                for kind, ref in placement.to_resources().items():
                    cur.execute(
                        "INSERT INTO tenant_resources (tenant_id, kind, ref, created_at, updated_at) "
                        "VALUES (%s, %s, %s, %s, %s)",
                        (tenant_id, kind, ref, now, now),
                    )
            if hasattr(conn, "commit"):
                conn.commit()
        return Tenant(tenant_id, slug, display_name, tier, plan, cell_id, c.region,
                      TenantStatus.PROVISIONING, is_synthetic, now, now)

    def lookup_tenant(self, tenant_id: str) -> Tenant:
        with self._conn_factory() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT tenant_id, slug, display_name, tier, plan_id, cell_id, region, "
                    "status, is_synthetic, created_at, updated_at FROM tenants WHERE tenant_id = %s",
                    (tenant_id,),
                )
                row = cur.fetchone()
                if not row:
                    raise RegistryError(f"unknown tenant {tenant_id!r}")
                cols = [desc[0] for desc in cur.description]
                d = dict(row) if isinstance(row, dict) else dict(zip(cols, row))
                return Tenant(d["tenant_id"], d["slug"], d["display_name"], Tier(d["tier"]),
                              d["plan_id"], d["cell_id"], d["region"], TenantStatus(d["status"]),
                              bool(d["is_synthetic"]), d["created_at"], d["updated_at"])

    def list(self) -> list[Tenant]:
        with self._conn_factory() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT tenant_id, slug, display_name, tier, plan_id, cell_id, region, "
                    "status, is_synthetic, created_at, updated_at FROM tenants ORDER BY created_at"
                )
                rows = cur.fetchall()
                if not rows:
                    return []
                cols = [desc[0] for desc in cur.description]
                return [Tenant(d["tenant_id"], d["slug"], d["display_name"], Tier(d["tier"]),
                               d["plan_id"], d["cell_id"], d["region"], TenantStatus(d["status"]),
                               bool(d["is_synthetic"]), d["created_at"], d["updated_at"])
                        for r in rows for d in [dict(r) if isinstance(r, dict) else dict(zip(cols, r))]]

    def set_status(self, tenant_id: str, status: TenantStatus) -> Tenant:
        t = self.lookup_tenant(tenant_id)
        if status == t.status:
            return t
        if status not in TRANSITIONS[t.status]:
            raise InvalidTransitionError(f"{t.status.value} -> {status.value} is not allowed")
        now = _now()
        with self._conn_factory() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE tenants SET status = %s, updated_at = %s WHERE tenant_id = %s",
                    (status.value, now, tenant_id),
                )
            if hasattr(conn, "commit"):
                conn.commit()
        return replace(t, status=status, updated_at=now)

    def set_resource(self, tenant_id: str, kind: str, ref: str) -> None:
        if kind not in PLACEMENT_KINDS:
            raise RegistryError(f"unknown resource kind {kind!r}")
        if kind in IMMUTABLE_KINDS:
            raise RegistryError(f"{kind} cannot be edited; moving a tenant is a migration")
        self.lookup_tenant(tenant_id)
        now = _now()
        with self._conn_factory() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO tenant_resources (tenant_id, kind, ref, created_at, updated_at) "
                    "VALUES (%s, %s, %s, %s, %s) "
                    "ON CONFLICT (tenant_id, kind) DO UPDATE SET ref = EXCLUDED.ref, updated_at = EXCLUDED.updated_at",
                    (tenant_id, kind, ref, now, now),
                )
            if hasattr(conn, "commit"):
                conn.commit()

    def lookup(self, tenant_id: str) -> TenantContext | None:
        try:
            t = self.lookup_tenant(tenant_id)
        except RegistryError:
            return None
        with self._conn_factory() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT kind, ref FROM tenant_resources WHERE tenant_id = %s", (tenant_id,))
                rows = cur.fetchall()
                res = {r[0]: r[1] for r in rows}
        return TenantContext(t.tenant_id, t.slug, t.status, t.tier, Placement.from_resources(res))

