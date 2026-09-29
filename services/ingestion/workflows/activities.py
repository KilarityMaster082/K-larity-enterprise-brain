# Owner task: EB-29 Temporal ingestion pipeline
"""Temporal activities and stage execution for durable document ingestion.

Pipeline stages:
  1. sync: Fetch incremental raw items and store raw payload with cursor update.
  2. parse: Extract structured text, headers, and metadata from raw bytes.
  3. chunk: Deterministic chunking with page / section provenance bounding boxes.
  4. embed: Generate vector representations using LLM gateway alias 'embed'.
  5. index: Write vectors to Qdrant and keywords to OpenSearch with tenant filter.
  6. extract_events: Extract timeline dates, approvals, milestones, and contracts.
  7. resolve_entities: Link extracted entities and relationships into the ontology graph.
"""

from __future__ import annotations

import dataclasses
import hashlib
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from connectors_sdk import (
    BaseConnector,
    Cursor,
    NormalizedRecord,
    RawItem,
    SourceContext,
    SourceStateStore,
)
from tenant_context import current_tenant_or_none


@dataclass(frozen=True)
class ActivityRetryPolicy:
    """Configures retry behavior and backoff for a Temporal activity."""

    initial_interval_seconds: float = 1.0
    backoff_coefficient: float = 2.0
    maximum_interval_seconds: float = 30.0
    maximum_attempts: int = 3
    non_retryable_errors: tuple[type[Exception], ...] = ()

    def delay_for_attempt(self, attempt: int) -> float:
        """Computes exponential backoff delay for the given attempt (1-indexed)."""
        if attempt <= 1:
            return self.initial_interval_seconds
        delay = self.initial_interval_seconds * (self.backoff_coefficient ** (attempt - 1))
        return min(delay, self.maximum_interval_seconds)


@dataclass(frozen=True)
class ActivityTimeout:
    """Activity timeout configurations."""

    start_to_close_seconds: float = 300.0
    schedule_to_close_seconds: float = 600.0


# Default policies per activity
DEFAULT_RETRY_POLICIES: dict[str, ActivityRetryPolicy] = {
    "sync": ActivityRetryPolicy(initial_interval_seconds=2.0, maximum_attempts=4),
    "parse": ActivityRetryPolicy(initial_interval_seconds=1.0, maximum_attempts=3),
    "chunk": ActivityRetryPolicy(initial_interval_seconds=0.5, maximum_attempts=2),
    "embed": ActivityRetryPolicy(initial_interval_seconds=1.0, maximum_attempts=4),
    "index": ActivityRetryPolicy(initial_interval_seconds=1.5, maximum_attempts=4),
    "extract_events": ActivityRetryPolicy(initial_interval_seconds=1.0, maximum_attempts=3),
    "resolve_entities": ActivityRetryPolicy(initial_interval_seconds=1.0, maximum_attempts=3),
}

DEFAULT_TIMEOUTS: dict[str, ActivityTimeout] = {
    "sync": ActivityTimeout(start_to_close_seconds=600.0),
    "parse": ActivityTimeout(start_to_close_seconds=300.0),
    "chunk": ActivityTimeout(start_to_close_seconds=120.0),
    "embed": ActivityTimeout(start_to_close_seconds=300.0),
    "index": ActivityTimeout(start_to_close_seconds=180.0),
    "extract_events": ActivityTimeout(start_to_close_seconds=240.0),
    "resolve_entities": ActivityTimeout(start_to_close_seconds=240.0),
}


def make_idempotency_key(tenant_id: str, source_id: str, record_ref: str, content_hash: str) -> str:
    """Subtask 3: Deterministic idempotency key ensuring duplicate runs are no-ops."""
    return f"{tenant_id}:{source_id}:{record_ref}:{content_hash}"


@dataclass
class ParsedDoc:
    """Document representation resulting from parsing."""

    tenant_id: str
    source_id: str
    external_id: str
    content_hash: str
    text_content: str
    metadata: dict[str, Any] = field(default_factory=dict)
    tables: list[dict[str, Any]] = field(default_factory=list)
    page_count: int = 1


@dataclass
class DocChunk:
    """A semantic chunk of a parsed document with provenance."""

    chunk_id: str
    tenant_id: str
    source_id: str
    external_id: str
    content_hash: str
    text: str
    chunk_index: int
    page_number: int = 1
    bounding_box: tuple[float, float, float, float] | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class EmbeddedChunk:
    """A chunk with associated vector embedding."""

    chunk: DocChunk
    embedding: list[float]
    model_alias: str = "embed"


@dataclass
class IndexResult:
    """Result of vector and keyword indexing."""

    tenant_id: str
    chunks_indexed: int
    vector_ids: list[str]
    doc_id: str


@dataclass
class ExtractedEvent:
    """Timeline event or decision discovered during ingestion."""

    event_id: str
    tenant_id: str
    event_type: str
    description: str
    event_date: str | None = None
    source_chunk_id: str | None = None
    confidence: float = 1.0


@dataclass
class ResolvedEntity:
    """Domain entity linked into the tenant ontology."""

    entity_id: str
    tenant_id: str
    entity_type: str
    name: str
    properties: dict[str, Any] = field(default_factory=dict)
    linked_event_ids: list[str] = field(default_factory=list)


def parse_doc_activity(
    tenant_id: str,
    source_id: str,
    external_id: str,
    content_hash: str,
    payload_bytes: bytes,
    mime_type: str = "text/plain",
) -> ParsedDoc:
    """Stage 2: Parse raw document bytes into structured text and tables."""
    text = payload_bytes.decode("utf-8", errors="replace")
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    metadata: dict[str, Any] = {
        "line_count": len(lines),
        "mime_type": mime_type,
        "byte_size": len(payload_bytes),
    }
    return ParsedDoc(
        tenant_id=tenant_id,
        source_id=source_id,
        external_id=external_id,
        content_hash=content_hash,
        text_content=text,
        metadata=metadata,
        page_count=max(1, len(lines) // 50),
    )


def chunk_doc_activity(parsed: ParsedDoc, max_chunk_chars: int = 800) -> list[DocChunk]:
    """Stage 3: Chunk parsed document into semantic spans with provenance."""
    chunks: list[DocChunk] = []
    text = parsed.text_content
    paragraphs = text.split("\n\n") if "\n\n" in text else text.splitlines()
    paragraphs = [p.strip() for p in paragraphs if p.strip()]

    current_chunk: list[str] = []
    current_length = 0
    chunk_idx = 0

    for para in paragraphs:
        if current_length + len(para) > max_chunk_chars and current_chunk:
            combined = "\n\n".join(current_chunk)
            cid = f"{parsed.external_id}-chk-{chunk_idx}"
            chunks.append(
                DocChunk(
                    chunk_id=cid,
                    tenant_id=parsed.tenant_id,
                    source_id=parsed.source_id,
                    external_id=parsed.external_id,
                    content_hash=parsed.content_hash,
                    text=combined,
                    chunk_index=chunk_idx,
                    page_number=1 + (chunk_idx // 3),
                )
            )
            chunk_idx += 1
            current_chunk = [para]
            current_length = len(para)
        else:
            current_chunk.append(para)
            current_length += len(para)

    if current_chunk:
        combined = "\n\n".join(current_chunk)
        cid = f"{parsed.external_id}-chk-{chunk_idx}"
        chunks.append(
            DocChunk(
                chunk_id=cid,
                tenant_id=parsed.tenant_id,
                source_id=parsed.source_id,
                external_id=parsed.external_id,
                content_hash=parsed.content_hash,
                text=combined,
                chunk_index=chunk_idx,
                page_number=1 + (chunk_idx // 3),
            )
        )

    return chunks


def embed_chunks_activity(
    chunks: list[DocChunk],
    embed_fn: Callable[[list[str]], list[list[float]]] | None = None,
) -> list[EmbeddedChunk]:
    """Stage 4: Generate vector embeddings for document chunks."""
    if not chunks:
        return []

    texts = [c.text for c in chunks]
    if embed_fn is not None:
        vectors = embed_fn(texts)
    else:
        # Deterministic mock/test embedding generator (dim=8)
        vectors = []
        for t in texts:
            seed = int(hashlib.sha256(t.encode("utf-8")).hexdigest()[:8], 16)
            vector = [(float((seed >> (i * 4)) & 0xF) / 15.0) for i in range(8)]
            vectors.append(vector)

    return [
        EmbeddedChunk(chunk=c, embedding=vec, model_alias="embed")
        for c, vec in zip(chunks, vectors, strict=True)
    ]


def index_chunks_activity(
    embedded_chunks: list[EmbeddedChunk],
    index_writer: Callable[[str, list[EmbeddedChunk]], list[str]] | None = None,
) -> IndexResult:
    """Stage 5: Index vectors into Qdrant and keywords into OpenSearch."""
    if not embedded_chunks:
        return IndexResult(tenant_id="", chunks_indexed=0, vector_ids=[], doc_id="")

    tenant_id = embedded_chunks[0].chunk.tenant_id
    doc_id = embedded_chunks[0].chunk.external_id

    if index_writer is not None:
        vids = index_writer(tenant_id, embedded_chunks)
    else:
        vids = [ec.chunk.chunk_id for ec in embedded_chunks]

    return IndexResult(
        tenant_id=tenant_id,
        chunks_indexed=len(embedded_chunks),
        vector_ids=vids,
        doc_id=doc_id,
    )


def extract_events_activity(chunks: list[DocChunk]) -> list[ExtractedEvent]:
    """Stage 6: Extract timeline dates, approvals, milestones, and contracts."""
    events: list[ExtractedEvent] = []
    for c in chunks:
        lower = c.text.lower()
        if "approved" in lower or "approval" in lower:
            events.append(
                ExtractedEvent(
                    event_id=f"evt-{c.chunk_id}",
                    tenant_id=c.tenant_id,
                    event_type="approval",
                    description=c.text[:200],
                    source_chunk_id=c.chunk_id,
                )
            )
        elif "invoice" in lower or "payment" in lower:
            events.append(
                ExtractedEvent(
                    event_id=f"evt-{c.chunk_id}",
                    tenant_id=c.tenant_id,
                    event_type="financial_transaction",
                    description=c.text[:200],
                    source_chunk_id=c.chunk_id,
                )
            )
    return events


def resolve_entities_activity(
    events: list[ExtractedEvent],
    chunks: list[DocChunk],
) -> list[ResolvedEntity]:
    """Stage 7: Link extracted entities and relationships into the ontology graph."""
    entities: list[ResolvedEntity] = []
    seen_names: set[str] = set()

    for c in chunks:
        # Simple extraction of title or capitalized terms
        words = c.text.split()
        for w in words:
            clean = w.strip(".,;:()[]{}\"'")
            if clean.startswith("Project") and clean not in seen_names:
                seen_names.add(clean)
                entities.append(
                    ResolvedEntity(
                        entity_id=f"ent-{c.tenant_id}-{clean.lower()}",
                        tenant_id=c.tenant_id,
                        entity_type="Project",
                        name=clean,
                        linked_event_ids=[e.event_id for e in events],
                    )
                )
    return entities
