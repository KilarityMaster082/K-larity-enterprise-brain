# Owner task: EB-42 Permission filtering before retrieval
"""Permission filtering for retrieval (CLAUDE.md rule 2).

Two layers, both driven by OpenFGA through :class:`PermissionsClient`:

1. **Before retrieval** — :meth:`PermissionFilter.scope_for` resolves the projects and documents a user may
   view; :meth:`AccessScope.filter_spec` turns that into a filter pushed down to the vector and lexical
   indexes, so forbidden chunks are never fetched.
2. **Before rendering** — :meth:`PermissionFilter.authorize` re-checks every candidate against OpenFGA (and its
   tenant) and drops anything not explicitly permitted. Deny by default: a candidate with no project or
   document identity is dropped.

Borrowed from: Onyx ACL tokens (O5) — the idea of pushing the caller's principals into the index filter;
adapted to OpenFGA relations instead of stored ACL token lists. Tenant scoping comes from the active
TenantContext, never from a caller-supplied value.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Protocol, TypeVar

from tenant_context import current_tenant

from .client import PermissionsClient


class _Candidate(Protocol):
    document_id: str
    project_id: str | None
    source_metadata: dict[str, Any]


C = TypeVar("C", bound=_Candidate)

FILTER_VERSION = 1


@dataclass(frozen=True)
class AccessScope:
    """What one user may see inside one tenant."""

    tenant_id: str
    user_id: str
    project_ids: frozenset[str]
    document_ids: frozenset[str]
    version: int = FILTER_VERSION

    @property
    def is_empty(self) -> bool:
        return not self.project_ids and not self.document_ids

    def filter_spec(self) -> dict[str, Any]:
        """Index filter. Qdrant-style ``must``; retrieve.py maps it to OpenSearch ``terms``.

        Projects and documents are alternatives (a document may be shared outside a project), so they are
        expressed as a single ``should`` group when both are present. An empty scope matches nothing.
        """
        if self.is_empty:
            # Matches no real chunk: the index never stores this sentinel.
            return {"must": [{"key": "project_id", "match": {"any": ["__no_access__"]}}]}
        if not self.document_ids:
            return {"must": [{"key": "project_id", "match": {"any": sorted(self.project_ids)}}]}
        if not self.project_ids:
            return {"must": [{"key": "document_id", "match": {"any": sorted(self.document_ids)}}]}
        return {"should": [
            {"key": "project_id", "match": {"any": sorted(self.project_ids)}},
            {"key": "document_id", "match": {"any": sorted(self.document_ids)}},
        ]}


class PermissionFilter:
    """Resolve an access scope and re-check retrieved candidates."""

    def __init__(self, client: PermissionsClient) -> None:
        self.client = client

    def scope_for(self, user_id: str) -> AccessScope:
        ctx = current_tenant()
        return AccessScope(
            tenant_id=ctx.tenant_id,
            user_id=user_id,
            project_ids=frozenset(self.client.list_accessible_projects(user_id)),
            document_ids=frozenset(self.client.list_accessible_documents(user_id)),
        )

    def can_view(self, user_id: str, candidate: _Candidate) -> bool:
        """Authoritative per-candidate check. Deny by default."""
        meta = candidate.source_metadata or {}
        tenant_id = meta.get("tenant_id")
        if tenant_id is not None and tenant_id != current_tenant().tenant_id:
            return False
        if candidate.document_id and self.client.can_view_document(user_id, candidate.document_id):
            return True
        if candidate.project_id and self.client.can_view_project(user_id, candidate.project_id):
            return True
        return False

    def authorize(self, user_id: str, candidates: Iterable[C]) -> list[C]:
        """Drop every candidate the user may not view. Preserves order."""
        return [c for c in candidates if self.can_view(user_id, c)]
