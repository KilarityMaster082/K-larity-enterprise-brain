# Owner task: EB-53 Decision Memory · EB-66 Approval model (SQL persistence)
"""Tenant-scoped row store over SQLAlchemy Core, used by decisions and approvals.

Two independent layers keep tenants apart (Risk R-6):
  * every statement carries ``tenant_id = :tenant_id`` explicitly, taken from the active TenantContext;
  * on PostgreSQL each transaction first binds ``app.tenant_id`` so FORCE row-level security applies as well.
A bug in either layer alone cannot expose another tenant's rows.

Rows are plain dicts (column → value) so the domain packages do not depend on SQLAlchemy. Column names come from a
fixed declaration, never from caller input; values are always bound parameters. Typed columns (json, timestamp,
numeric) get an explicit CAST on PostgreSQL and are normalised on the way out, so SQLite (tests) and PostgreSQL
return the same Python values.
"""

from __future__ import annotations

import json
from contextlib import contextmanager
from datetime import datetime
from decimal import Decimal
from typing import Any, Iterator, Mapping, Sequence

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine
from tenant_context import CrossTenantAccessError, TenantScopedStore

from .database_session import bind_session_tenant

_PG_CAST = {"json": "jsonb", "timestamp": "timestamptz", "numeric": "numeric"}


class RecordConflictError(Exception):
    """The row changed since it was read (optimistic concurrency)."""


class SqlRecordStore(TenantScopedStore):
    def __init__(self, engine: Engine, table: str, key: str, columns: Mapping[str, str], *, version_column: str | None) -> None:
        """``columns``: name → type in {"text", "int", "json", "timestamp", "numeric"}; must include tenant_id, key, version."""
        for name in (table, key, *([version_column] if version_column else []), *columns):
            if not name.isidentifier():
                raise ValueError(f"unsafe SQL identifier: {name!r}")
        if not {"tenant_id", key, *([version_column] if version_column else [])} <= set(columns):
            raise ValueError("columns must include tenant_id, the key and the version column")
        self._engine, self._table, self._key, self._cols, self._ver = engine, table, key, dict(columns), version_column
        self._pg = engine.dialect.name == "postgresql"

    # -- plumbing ---------------------------------------------------------------------------------------------
    @contextmanager
    def _tx(self, tenant_id: str) -> Iterator[Connection]:
        with self._engine.begin() as conn:
            if self._pg:
                bind_session_tenant(conn, tenant_id)  # SET LOCAL-equivalent: RLS now applies to this transaction
            yield conn

    def _param(self, name: str) -> str:
        kind = self._cols[name]
        return f"CAST(:{name} AS {_PG_CAST[kind]})" if self._pg and kind in _PG_CAST else f":{name}"

    def _encode(self, row: Mapping[str, Any]) -> dict[str, Any]:
        unknown = set(row) - set(self._cols)
        if unknown:
            raise ValueError(f"unknown columns: {sorted(unknown)}")
        out: dict[str, Any] = {}
        for name in self._cols:
            value = row.get(name)
            kind = self._cols[name]
            if value is not None and kind == "json":
                value = json.dumps(value, sort_keys=True, default=str)
            elif isinstance(value, datetime):
                value = value.isoformat()
            elif isinstance(value, Decimal):
                value = str(value)
            out[name] = value
        return out

    def _decode(self, mapping: Mapping[str, Any]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for name, kind in self._cols.items():
            value = mapping[name]
            if value is not None:
                if kind == "json" and isinstance(value, (str, bytes)):
                    value = json.loads(value)
                elif kind == "timestamp" and isinstance(value, datetime):
                    value = value.isoformat()
                elif kind == "numeric":
                    value = str(value)
            out[name] = value
        return out

    def _select(self) -> str:
        return f"SELECT {', '.join(self._cols)} FROM {self._table}"

    # -- operations -------------------------------------------------------------------------------------------
    def get(self, tenant_id: str, key: str) -> dict[str, Any] | None:
        with self._tx(tenant_id) as conn:
            row = conn.execute(text(f"{self._select()} WHERE tenant_id = :tenant_id AND {self._key} = :key"),
                               {"tenant_id": tenant_id, "key": key}).mappings().first()
        return self._decode(row) if row else None

    def list(self, tenant_id: str, *, order_by: str | None = None, limit: int | None = None) -> list[dict[str, Any]]:
        order = order_by or self._key
        if order not in self._cols:
            raise ValueError(f"unknown order column: {order!r}")
        tail = f" LIMIT {int(limit)}" if limit is not None else ""
        with self._tx(tenant_id) as conn:
            rows = conn.execute(text(f"{self._select()} WHERE tenant_id = :tenant_id ORDER BY {order}{tail}"),
                                {"tenant_id": tenant_id}).mappings().all()
        return [self._decode(r) for r in rows]

    def _check_tenant(self, tenant_id: str, row: Mapping[str, Any]) -> None:
        if row.get("tenant_id") != tenant_id:
            raise CrossTenantAccessError(f"row tenant {row.get('tenant_id')!r} does not match active tenant {tenant_id!r}")

    def insert(self, tenant_id: str, row: Mapping[str, Any]) -> None:
        """Insert a new row. Raises RecordConflictError if the key already exists."""
        self._check_tenant(tenant_id, row)
        cols = list(self._cols)
        sql = f"INSERT INTO {self._table} ({', '.join(cols)}) VALUES ({', '.join(self._param(c) for c in cols)})"
        try:
            with self._tx(tenant_id) as conn:
                conn.execute(text(sql), self._encode(row))
        except Exception as exc:
            if "unique" in str(exc).lower() or "duplicate" in str(exc).lower() or "constraint" in str(exc).lower():
                raise RecordConflictError(str(row.get(self._key))) from exc
            raise

    def update_if_version(self, tenant_id: str, row: Mapping[str, Any], expected_version: int) -> bool:
        """Overwrite the row only if its stored version equals ``expected_version`` (compare-and-set)."""
        if self._ver is None:
            raise TypeError("this table is append-only: it has no version column and cannot be updated")
        self._check_tenant(tenant_id, row)
        sets = [c for c in self._cols if c not in ("tenant_id", self._key)]
        sql = (f"UPDATE {self._table} SET {', '.join(f'{c} = {self._param(c)}' for c in sets)} "
               f"WHERE tenant_id = :tenant_id AND {self._key} = :{self._key} AND {self._ver} = :expected_version")
        with self._tx(tenant_id) as conn:
            result = conn.execute(text(sql), {**self._encode(row), "expected_version": expected_version})
        return result.rowcount == 1
