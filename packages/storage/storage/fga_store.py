# Owner task: EB-22 OpenFGA authorization model and tuple sync
"""OpenFGA tenant-scoped store wrapper.

Wraps authorization checks and tuple synchronization inside TenantScopedStore.
All calls automatically bind to the active tenant's OpenFGA store (`p.fga_store`),
preventing cross-tenant permission leakages (Risk R-6).

Subtask 5: Check Cache TTL decision (D-17): 15 seconds TTL.
Fast response for iterative permission queries during document retrieval,
while ensuring revoked ACLs take effect within 15 seconds.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Protocol, Sequence

from tenant_context import CrossTenantAccessError, TenantScopedStore


@dataclass(frozen=True)
class TupleKey:
    user: str
    relation: str
    object: str
    condition_name: str | None = None

    def to_dict(self) -> dict[str, str]:
        d = {"user": self.user, "relation": self.relation, "object": self.object}
        if self.condition_name:
            d["condition_name"] = self.condition_name
        return d


class FgaBackend(Protocol):
    """Protocol for OpenFGA API execution (local mock or openfga_sdk)."""

    def check(self, store_id: str, user: str, relation: str, object_name: str) -> bool: ...

    def list_objects(self, store_id: str, user: str, relation: str, object_type: str) -> list[str]: ...

    def write_tuples(self, store_id: str, writes: Sequence[TupleKey], deletes: Sequence[TupleKey]) -> None: ...


class LocalFgaBackend:
    """In-memory OpenFGA evaluator for development and testing."""

    def __init__(self) -> None:
        # store_id -> set of (user, relation, object)
        self._tuples: dict[str, set[tuple[str, str, str]]] = {}

    def write_tuples(self, store_id: str, writes: Sequence[TupleKey], deletes: Sequence[TupleKey]) -> None:
        store = self._tuples.setdefault(store_id, set())
        for d in deletes:
            store.discard((d.user, d.relation, d.object))
        for w in writes:
            store.add((w.user, w.relation, w.object))

    def _resolve_relation(self, store: set[tuple[str, str, str]], user: str, rel: str, obj: str, visited: set[str] | None = None) -> bool:
        if visited is None:
            visited = set()
        key = f"{user}:{rel}@{obj}"
        if key in visited:
            return False
        visited.add(key)

        # 1. Direct tuple
        if (user, rel, obj) in store:
            return True

        obj_type, _, obj_id = obj.partition(":")

        # 2. Model inheritance rules:
        if obj_type == "tenant":
            if rel == "member":
                return self._resolve_relation(store, user, "admin", obj, visited)
            if rel == "viewer":
                return self._resolve_relation(store, user, "member", obj, visited)
            if rel == "finance_viewer":
                return self._resolve_relation(store, user, "admin", obj, visited)

        elif obj_type == "project":
            if rel == "member":
                return self._resolve_relation(store, user, "lead", obj, visited)
            if rel == "viewer":
                if self._resolve_relation(store, user, "member", obj, visited):
                    return True
                # Check parent tenant admin
                for u, r, o in store:
                    if r == "parent" and o == obj and u.startswith("tenant:"):
                        if self._resolve_relation(store, user, "admin", u, visited):
                            return True
            if rel == "editor":
                if self._resolve_relation(store, user, "lead", obj, visited):
                    return True
                for u, r, o in store:
                    if r == "parent" and o == obj and u.startswith("tenant:"):
                        if self._resolve_relation(store, user, "admin", u, visited):
                            return True
            if rel == "finance_viewer":
                for u, r, o in store:
                    if r == "parent" and o == obj and u.startswith("tenant:"):
                        if self._resolve_relation(store, user, "finance_viewer", u, visited):
                            return True

        elif obj_type in ("document", "drawing"):
            if rel == "viewer":
                if (user, rel, obj) in store:
                    return True
                for u, r, o in store:
                    if r == "parent" and o == obj and u.startswith("project:"):
                        if self._resolve_relation(store, user, "viewer", u, visited):
                            return True
            if rel == "editor":
                if (user, rel, obj) in store:
                    return True
                for u, r, o in store:
                    if r == "parent" and o == obj and u.startswith("project:"):
                        if self._resolve_relation(store, user, "editor", u, visited):
                            return True

        elif obj_type == "financial_record":
            if rel == "viewer":
                for u, r, o in store:
                    if r == "parent" and o == obj and u.startswith("project:"):
                        if self._resolve_relation(store, user, "finance_viewer", u, visited):
                            return True
            if rel == "editor":
                for u, r, o in store:
                    if r == "parent" and o == obj and u.startswith("project:"):
                        if self._resolve_relation(store, user, "lead", u, visited):
                            return True
                        # Or tenant admin
                        for pu, pr, po in store:
                            if pr == "parent" and po == u and pu.startswith("tenant:"):
                                if self._resolve_relation(store, user, "admin", pu, visited):
                                    return True

        elif obj_type == "decision":
            if rel == "viewer":
                for u, r, o in store:
                    if r == "parent" and o == obj and u.startswith("project:"):
                        if self._resolve_relation(store, user, "viewer", u, visited):
                            return True
            if rel == "reviewer":
                for u, r, o in store:
                    if r == "parent" and o == obj and u.startswith("project:"):
                        if self._resolve_relation(store, user, "lead", u, visited):
                            return True
                        for pu, pr, po in store:
                            if pr == "parent" and po == u and pu.startswith("tenant:"):
                                if self._resolve_relation(store, user, "admin", pu, visited):
                                    return True

        return False

    def check(self, store_id: str, user: str, relation: str, object_name: str) -> bool:
        store = self._tuples.get(store_id, set())
        return self._resolve_relation(store, user, relation, object_name)

    def list_objects(self, store_id: str, user: str, relation: str, object_type: str) -> list[str]:
        store = self._tuples.get(store_id, set())
        all_objects = {t[2] for t in store if t[2].startswith(f"{object_type}:")}
        return sorted([obj for obj in all_objects if self._resolve_relation(store, user, relation, obj)])


class FgaStore(TenantScopedStore):
    """Tenant-scoped OpenFGA client with automatic check caching (TTL: 15s)."""

    def __init__(self, backend: FgaBackend, *, cache_ttl_seconds: float = 15.0) -> None:
        self._backend = backend
        self._cache_ttl = cache_ttl_seconds
        # (store_id, user, relation, object) -> (expiry, result)
        self._check_cache: dict[tuple[str, str, str, str], tuple[float, bool]] = {}

    def _store_id(self) -> str:
        return self._placement().fga_store

    def check(self, user: str, relation: str, object_name: str) -> bool:
        """Check if user has relation on object with TTL cache."""
        store_id = self._store_id()
        cache_key = (store_id, user, relation, object_name)
        now = time.monotonic()

        cached = self._check_cache.get(cache_key)
        if cached is not None and cached[0] > now:
            return cached[1]

        res = self._backend.check(store_id, user, relation, object_name)
        self._check_cache[cache_key] = (now + self._cache_ttl, res)
        return res

    def list_objects(self, user: str, relation: str, object_type: str) -> list[str]:
        """List all object identifiers of object_type where user has relation."""
        store_id = self._store_id()
        return self._backend.list_objects(store_id, user, relation, object_type)

    def write_tuples(
        self,
        writes: Sequence[TupleKey] | None = None,
        deletes: Sequence[TupleKey] | None = None,
    ) -> None:
        """Write and/or delete relation tuples, invalidating check cache."""
        store_id = self._store_id()
        self._backend.write_tuples(store_id, writes or [], deletes or [])
        # Invalidate cache for the active tenant store
        self._check_cache = {
            k: v for k, v in self._check_cache.items() if k[0] != store_id
        }
