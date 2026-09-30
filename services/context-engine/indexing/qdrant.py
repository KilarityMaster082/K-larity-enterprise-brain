# Owner task: EB-36 Indexing: OpenSearch + Qdrant with ACL
"""Qdrant side of chunk indexing: collection config, payload indexes and the point shape for a chunk.

Tenant isolation comes from the tenant shard key plus the mandatory ``tenant_id`` filter that VectorStore adds;
``project_id`` / ``document_id`` payload indexes make the permission filter's ``match.any`` cheap.
"""

from __future__ import annotations

from typing import Any

from storage import VectorPoint

from services.normalization.models import DocumentChunk

EMBEDDING_DIM = 1024  # bge-m3 class embeddings; must match services/llm-gateway model shortlist (EB-10)

COLLECTION_CONFIG: dict[str, Any] = {
    "vectors": {"size": EMBEDDING_DIM, "distance": "Cosine"},
    "sharding_method": "custom",  # shard key = tenant placement shard
    "on_disk_payload": True,
}

PAYLOAD_INDEXES: dict[str, str] = {
    "tenant_id": "keyword", "project_id": "keyword", "document_id": "keyword", "source_type": "keyword",
    "timestamp": "datetime",
}


def chunk_point(chunk: DocumentChunk, vector: list[float], *, project_id: str | None, source_id: str | None,
                source_type: str, timestamp: str | None) -> VectorPoint:
    payload: dict[str, Any] = {"document_id": chunk.document_id, "chunk_id": chunk.chunk_id, "text": chunk.text,
                               "source_type": source_type, "chunk_type": chunk.chunk_type}
    for key, value in (("project_id", project_id), ("source_id", source_id), ("timestamp", timestamp)):
        if value is not None:
            payload[key] = value
    return VectorPoint(id=chunk.chunk_id, vector=vector, payload=payload)
