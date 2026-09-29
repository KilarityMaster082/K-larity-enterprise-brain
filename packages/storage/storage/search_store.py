# Owner task: EB-20 RLS and tenant middleware
"""Tenant-scoped search store wrapper for OpenSearch.

Ensures that every keyword, BM25, and hybrid text search is strictly scoped to the
active tenant's index or alias (placement.opensearch_index / opensearch_alias) and
automatically wraps search bodies with a mandatory `{"term": {"tenant_id": ctx.tenant_id}}` filter.
Attempts to index documents belonging to a foreign tenant raise CrossTenantAccessError.
Calling any method without an active TenantContext raises NoTenantContextError.
"""

from __future__ import annotations

from typing import Any, Protocol, Sequence

from tenant_context import CrossTenantAccessError, TenantScopedStore


class SearchBackend(Protocol):
    """Protocol for OpenSearch client implementations (mock or live client)."""
    def index(self, index_name: str, doc_id: str, document: dict[str, Any]) -> None: ...
    def search(self, index_name: str, query: dict[str, Any]) -> list[dict[str, Any]]: ...
    def delete(self, index_name: str, doc_id: str) -> None: ...
    def count(self, index_name: str, query: dict[str, Any]) -> int: ...


class SearchStore(TenantScopedStore):
    """Tenant-scoped text search store guard subclassing TenantScopedStore."""

    def __init__(self, backend: SearchBackend) -> None:
        self._backend = backend

    def _index_name(self) -> str:
        """Resolve the active tenant's index or alias from placement."""
        p = self._placement()
        return p.opensearch_alias or p.opensearch_index

    def _tenant_filter(self) -> dict[str, Any]:
        """Generate mandatory OpenSearch term filter."""
        ctx = self._tenant()
        return {"term": {"tenant_id": ctx.tenant_id}}

    def index(self, doc_id: str, document: dict[str, Any]) -> None:
        """Index a document, validating and stamping the active tenant_id."""
        ctx = self._tenant()
        specified_tenant = document.get("tenant_id")
        if specified_tenant is not None and specified_tenant != ctx.tenant_id:
            raise CrossTenantAccessError(
                f"Document contains foreign tenant_id {specified_tenant!r} "
                f"under active tenant {ctx.tenant_id!r}"
            )

        doc_copy = dict(document)
        doc_copy["tenant_id"] = ctx.tenant_id
        self._backend.index(index_name=self._index_name(), doc_id=doc_id, document=doc_copy)

    def search(self, query: dict[str, Any]) -> list[dict[str, Any]]:
        """Execute a search query with mandatory tenant_id filter injection."""
        ctx = self._tenant()
        tenant_term = self._tenant_filter()

        # Wrap or inject into bool filter
        wrapped_query: dict[str, Any] = {
            "bool": {
                "must": [query.get("query", query)],
                "filter": [tenant_term],
            }
        }
        return self._backend.search(index_name=self._index_name(), query=wrapped_query)

    def delete(self, doc_id: str) -> None:
        """Delete a document by ID from the tenant's index."""
        self._backend.delete(index_name=self._index_name(), doc_id=doc_id)

    def count(self, query: dict[str, Any] | None = None) -> int:
        """Count documents matching the query and tenant filter."""
        tenant_term = self._tenant_filter()
        wrapped_query: dict[str, Any] = {
            "bool": {
                "filter": [tenant_term],
            }
        }
        if query:
            wrapped_query["bool"]["must"] = [query.get("query", query)]

        return self._backend.count(index_name=self._index_name(), query=wrapped_query)


class LocalSearchBackend:
    """In-memory search backend for tests and development."""

    def __init__(self) -> None:
        # index_name -> dict[doc_id, document]
        self._indices: dict[str, dict[str, dict[str, Any]]] = {}

    def _get_index(self, index_name: str) -> dict[str, dict[str, Any]]:
        if index_name not in self._indices:
            self._indices[index_name] = {}
        return self._indices[index_name]

    def index(self, index_name: str, doc_id: str, document: dict[str, Any]) -> None:
        idx = self._get_index(index_name)
        idx[doc_id] = document

    def delete(self, index_name: str, doc_id: str) -> None:
        idx = self._get_index(index_name)
        idx.pop(doc_id, None)

    def search(self, index_name: str, query: dict[str, Any]) -> list[dict[str, Any]]:
        idx = self._get_index(index_name)
        results: list[dict[str, Any]] = []

        # Extract tenant filter if present in query
        expected_tenant = None
        filter_clause = query.get("bool", {}).get("filter", [])
        for f in filter_clause:
            if "term" in f and "tenant_id" in f["term"]:
                expected_tenant = f["term"]["tenant_id"]

        for doc in idx.values():
            if expected_tenant is not None and doc.get("tenant_id") != expected_tenant:
                continue
            results.append(doc)

        return results

    def count(self, index_name: str, query: dict[str, Any]) -> int:
        return len(self.search(index_name, query))
