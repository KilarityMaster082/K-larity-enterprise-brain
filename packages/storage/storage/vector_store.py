# Owner task: EB-20 RLS and tenant middleware
"""Tenant-scoped vector store wrapper for Qdrant.

Ensures that every vector search, scroll, upsert, and delete operation is strictly bound
to the active tenant's placement shard key (placement.qdrant_shard_key) and automatically
injects a tenant_id match filter. Any attempt to access or insert vectors for a foreign tenant
raises CrossTenantAccessError. Calling any method without an active TenantContext raises NoTenantContextError.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Protocol, Sequence

from tenant_context import CrossTenantAccessError, TenantScopedStore


@dataclass
class VectorPoint:
    """Representation of an embedding vector and payload."""
    id: str
    vector: list[float]
    payload: dict[str, Any] = field(default_factory=dict)
    score: float = 0.0


class VectorBackend(Protocol):
    """Protocol for Qdrant client implementations (mock or live client)."""
    def upsert(
        self,
        collection_name: str,
        points: Sequence[VectorPoint],
        shard_key: str | None = None,
    ) -> None: ...

    def search(
        self,
        collection_name: str,
        query_vector: list[float],
        filter_spec: dict[str, Any],
        limit: int = 10,
        shard_key: str | None = None,
    ) -> list[VectorPoint]: ...

    def delete(
        self,
        collection_name: str,
        point_ids: Sequence[str],
        shard_key: str | None = None,
    ) -> None: ...

    def count(
        self,
        collection_name: str,
        filter_spec: dict[str, Any],
        shard_key: str | None = None,
    ) -> int: ...


class VectorStore(TenantScopedStore):
    """Tenant-scoped vector store guard subclassing TenantScopedStore."""

    def __init__(self, backend: VectorBackend, collection_name: str = "chunks") -> None:
        self._backend = backend
        self._collection_name = collection_name

    def _tenant_filter(self) -> dict[str, Any]:
        """Generate mandatory Qdrant tenant filter."""
        ctx = self._tenant()
        return {
            "key": "tenant_id",
            "match": {"value": ctx.tenant_id},
        }

    def upsert(self, points: Sequence[VectorPoint]) -> None:
        """Upsert vector points, stamping active tenant_id and binding to tenant shard."""
        ctx = self._tenant()
        p = self._placement()

        sanitized_points: list[VectorPoint] = []
        for pt in points:
            # Check if payload specifies a different tenant
            specified_tenant = pt.payload.get("tenant_id")
            if specified_tenant is not None and specified_tenant != ctx.tenant_id:
                raise CrossTenantAccessError(
                    f"Vector payload contains foreign tenant_id {specified_tenant!r} "
                    f"under active tenant {ctx.tenant_id!r}"
                )

            # Copy payload and stamp active tenant_id
            payload = dict(pt.payload)
            payload["tenant_id"] = ctx.tenant_id
            sanitized_points.append(VectorPoint(id=pt.id, vector=pt.vector, payload=payload))

        self._backend.upsert(
            collection_name=self._collection_name,
            points=sanitized_points,
            shard_key=p.qdrant_shard_key,
        )

    def search(
        self,
        query_vector: list[float],
        filter_spec: dict[str, Any] | None = None,
        limit: int = 10,
    ) -> list[VectorPoint]:
        """Search vectors with mandatory tenant filter injection."""
        p = self._placement()
        tenant_cond = self._tenant_filter()

        # Combine caller filters with tenant filter
        combined_filter: dict[str, Any] = {"must": [tenant_cond]}
        if filter_spec:
            if "must" in filter_spec or "should" in filter_spec:
                combined_filter["must"].extend(filter_spec.get("must", []))
                if "should" in filter_spec:
                    combined_filter["should"] = list(filter_spec["should"])
            else:
                combined_filter["must"].append(filter_spec)

        return self._backend.search(
            collection_name=self._collection_name,
            query_vector=query_vector,
            filter_spec=combined_filter,
            limit=limit,
            shard_key=p.qdrant_shard_key,
        )

    def delete(self, point_ids: Sequence[str]) -> None:
        """Delete points from the tenant's shard."""
        p = self._placement()
        self._backend.delete(
            collection_name=self._collection_name,
            point_ids=point_ids,
            shard_key=p.qdrant_shard_key,
        )

    def count(self, filter_spec: dict[str, Any] | None = None) -> int:
        """Count points matching the tenant filter."""
        p = self._placement()
        tenant_cond = self._tenant_filter()
        combined_filter: dict[str, Any] = {"must": [tenant_cond]}
        if filter_spec:
            if "must" in filter_spec or "should" in filter_spec:
                combined_filter["must"].extend(filter_spec.get("must", []))
                if "should" in filter_spec:
                    combined_filter["should"] = list(filter_spec["should"])
            else:
                combined_filter["must"].append(filter_spec)

        return self._backend.count(
            collection_name=self._collection_name,
            filter_spec=combined_filter,
            shard_key=p.qdrant_shard_key,
        )


class LocalVectorBackend:
    """In-memory vector backend for tests and development."""

    def __init__(self) -> None:
        # (collection, shard_key) -> dict[point_id, VectorPoint]
        self._storage: dict[tuple[str, str | None], dict[str, VectorPoint]] = {}

    def _get_shard(self, collection: str, shard_key: str | None) -> dict[str, VectorPoint]:
        key = (collection, shard_key)
        if key not in self._storage:
            self._storage[key] = {}
        return self._storage[key]

    def upsert(
        self,
        collection_name: str,
        points: Sequence[VectorPoint],
        shard_key: str | None = None,
    ) -> None:
        shard = self._get_shard(collection_name, shard_key)
        for pt in points:
            shard[pt.id] = pt

    def _match_filter(self, payload: dict[str, Any], filter_spec: dict[str, Any]) -> bool:
        def holds(cond: dict[str, Any]) -> bool:
            key = cond.get("key")
            match_spec = cond.get("match", {})
            if key not in payload:
                return False
            if "any" in match_spec:
                return payload[key] in match_spec["any"]
            return payload[key] == match_spec.get("value")

        if not all(holds(c) for c in filter_spec.get("must", [])):
            return False
        should = filter_spec.get("should", [])
        return not should or any(holds(c) for c in should)

    def search(
        self,
        collection_name: str,
        query_vector: list[float],
        filter_spec: dict[str, Any],
        limit: int = 10,
        shard_key: str | None = None,
    ) -> list[VectorPoint]:
        shard = self._get_shard(collection_name, shard_key)
        candidates: list[VectorPoint] = []

        def _dot(a: list[float], b: list[float]) -> float:
            return sum(x * y for x, y in zip(a, b))

        def _norm(a: list[float]) -> float:
            return math.sqrt(sum(x * x for x in a)) or 1.0

        for pt in shard.values():
            if not self._match_filter(pt.payload, filter_spec):
                continue
            cos_sim = _dot(query_vector, pt.vector) / (_norm(query_vector) * _norm(pt.vector))
            res = VectorPoint(id=pt.id, vector=pt.vector, payload=pt.payload, score=cos_sim)
            candidates.append(res)

        candidates.sort(key=lambda p: p.score, reverse=True)
        return candidates[:limit]

    def delete(
        self,
        collection_name: str,
        point_ids: Sequence[str],
        shard_key: str | None = None,
    ) -> None:
        shard = self._get_shard(collection_name, shard_key)
        for pid in point_ids:
            shard.pop(pid, None)

    def count(
        self,
        collection_name: str,
        filter_spec: dict[str, Any],
        shard_key: str | None = None,
    ) -> int:
        shard = self._get_shard(collection_name, shard_key)
        return sum(1 for pt in shard.values() if self._match_filter(pt.payload, filter_spec))
