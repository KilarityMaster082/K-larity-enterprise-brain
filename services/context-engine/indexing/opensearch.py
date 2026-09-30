# Owner task: EB-36 Indexing: OpenSearch + Qdrant with ACL
"""OpenSearch side of chunk indexing: index mapping and the document shape for a chunk.

Every filterable field is a ``keyword`` so the permission filter (packages/permissions/filter.py) can push
``terms`` clauses down; ``tenant_id`` is stamped by SearchStore, never by this module.

Borrowed from: Onyx document-index schema (O7/O9/O10) — one denormalised document per chunk carrying its access
fields; adapted to OpenFGA (project/document ids) instead of stored ACL token lists.
"""

from __future__ import annotations

from typing import Any

from services.normalization.models import DocumentChunk

MAPPING_VERSION = 1

INDEX_MAPPING: dict[str, Any] = {
    "settings": {"index": {"number_of_shards": 1, "number_of_replicas": 1}},
    "mappings": {
        "dynamic": "strict",
        "_meta": {"version": MAPPING_VERSION},
        "properties": {
            "tenant_id": {"type": "keyword"},
            "document_id": {"type": "keyword"},
            "chunk_id": {"type": "keyword"},
            "project_id": {"type": "keyword"},
            "source_id": {"type": "keyword"},
            "source_type": {"type": "keyword"},
            "chunk_type": {"type": "keyword"},
            "chunk_index": {"type": "integer"},
            "timestamp": {"type": "date"},
            "text": {"type": "text"},
            "context_header": {"type": "text"},
        },
    },
}


def chunk_document(chunk: DocumentChunk, *, project_id: str | None, source_id: str | None, source_type: str,
                   timestamp: str | None) -> dict[str, Any]:
    doc: dict[str, Any] = {
        "document_id": chunk.document_id, "chunk_id": chunk.chunk_id, "source_type": source_type,
        "chunk_type": chunk.chunk_type, "chunk_index": chunk.chunk_index, "text": chunk.text,
    }
    for key, value in (("project_id", project_id), ("source_id", source_id), ("timestamp", timestamp),
                       ("context_header", chunk.context_header)):
        if value is not None:
            doc[key] = value
    return doc
