# Owner task: EB-36 Indexing: OpenSearch + Qdrant with ACL
"""Write normalised chunks into both indexes with the access fields the permission filter needs.

* Every chunk gets ``project_id`` / ``document_id`` (and source metadata) in both OpenSearch and Qdrant, so
  retrieval can be filtered by what a user may see *before* any text is fetched (rule 2).
* ``tenant_id`` is stamped by the tenant-scoped stores; a chunk that names another tenant is refused.
* Deterministic ids (chunk_id) make indexing idempotent — re-running a document overwrites, never duplicates.
* Embedding happens first; if it fails nothing is written. If the second store fails, the first write is rolled
  back, so a document is never searchable in one index only.
* A per-document ledger allows clean deletion (source removed, person erased under DPDP) from both indexes.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Callable, Protocol, Sequence

from storage import SearchStore, VectorStore
from tenant_context import CrossTenantAccessError, current_tenant

from services.normalization.models import DocumentChunk

from .opensearch import chunk_document
from .qdrant import EMBEDDING_DIM, chunk_point


class Embedder(Protocol):
    def __call__(self, texts: Sequence[str]) -> list[list[float]]: ...


class IndexingError(Exception):
    pass


@dataclass(frozen=True)
class ChunkAccess:
    """Access/source fields shared by every chunk of one document."""

    project_id: str | None
    source_type: str
    source_id: str | None = None
    timestamp: str | None = None


class ChunkIndexer:
    def __init__(self, search: SearchStore, vectors: VectorStore, embed: Embedder, *, batch_size: int = 64,
                 dim: int = EMBEDDING_DIM) -> None:
        self.search, self.vectors, self.embed, self.batch_size, self.dim = search, vectors, embed, batch_size, dim
        self._ledger: dict[tuple[str, str], list[str]] = {}
        self._lock = threading.Lock()

    def index_document(self, chunks: Sequence[DocumentChunk], access: ChunkAccess) -> int:
        tenant = current_tenant().tenant_id
        if not chunks:
            return 0
        for c in chunks:
            if c.tenant_id != tenant:
                raise CrossTenantAccessError(f"chunk {c.chunk_id!r} belongs to tenant {c.tenant_id!r}, active is {tenant!r}")
        document_ids = {c.document_id for c in chunks}
        if len(document_ids) != 1:
            raise IndexingError("index_document takes the chunks of exactly one document")
        document_id = document_ids.pop()

        written = 0
        for i in range(0, len(chunks), self.batch_size):
            batch = chunks[i:i + self.batch_size]
            vectors = self.embed([c.text for c in batch])
            if len(vectors) != len(batch) or any(len(v) != self.dim for v in vectors):
                raise IndexingError(f"embedder must return {len(batch)} vectors of dimension {self.dim}")
            points = [chunk_point(c, v, project_id=access.project_id, source_id=access.source_id,
                                  source_type=access.source_type, timestamp=access.timestamp)
                      for c, v in zip(batch, vectors)]
            self.vectors.upsert(points)
            try:
                for c in batch:
                    self.search.index(c.chunk_id, chunk_document(c, project_id=access.project_id, source_id=access.source_id,
                                                                  source_type=access.source_type, timestamp=access.timestamp))
            except Exception:
                self.vectors.delete([p.id for p in points])  # never leave a chunk in one index only
                for c in batch:
                    self.search.delete(c.chunk_id)
                raise
            written += len(batch)
        with self._lock:
            known = self._ledger.setdefault((tenant, document_id), [])
            known.extend(c.chunk_id for c in chunks if c.chunk_id not in known)
        return written

    def delete_document(self, document_id: str) -> int:
        tenant = current_tenant().tenant_id
        with self._lock:
            ids = self._ledger.pop((tenant, document_id), [])
        if ids:
            self.vectors.delete(ids)
            for chunk_id in ids:
                self.search.delete(chunk_id)
        return len(ids)

    def chunk_ids(self, document_id: str) -> list[str]:
        return list(self._ledger.get((current_tenant().tenant_id, document_id), []))
