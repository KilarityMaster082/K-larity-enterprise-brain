# Owner task: EB-46 Context compression and caching
"""Context compression, near-duplicate removal, evidence ID preservation, and answer caching."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import hashlib
import logging
import re
import time
from typing import Any

from services.normalization.models import DocumentChunk
from services.normalization.provenance.spans import ProvenanceSpan

logger = logging.getLogger(__name__)


class QueryIntent(str, Enum):
    """Retrieval intent categories determining optimal context token budget."""

    FACTOID = "factoid"
    LOOKUP = "lookup"
    SUMMARY = "summary"
    COMPARISON = "comparison"
    ANALYSIS = "analysis"
    DEEP_REASONING = "deep_reasoning"
    DEFAULT = "default"


# Default context token budgets by intent
INTENT_TOKEN_BUDGETS: dict[QueryIntent, int] = {
    QueryIntent.FACTOID: 1500,
    QueryIntent.LOOKUP: 2000,
    QueryIntent.SUMMARY: 3500,
    QueryIntent.COMPARISON: 5000,
    QueryIntent.ANALYSIS: 6500,
    QueryIntent.DEEP_REASONING: 8000,
    QueryIntent.DEFAULT: 4000,
}


@dataclass
class EvidenceCandidate:
    """Individual retrieved evidence candidate before/after compression."""

    evidence_id: str
    text: str
    document_id: str
    chunk_id: str
    score: float = 1.0
    provenance: ProvenanceSpan | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    token_count: int = 0
    is_duplicate: bool = False

    def __post_init__(self) -> None:
        if not self.token_count:
            # Approximate token count (1 token ≈ 4 characters or ~0.75 words)
            self.token_count = max(1, len(self.text.split()) * 4 // 3)

    @classmethod
    def from_document_chunk(
        cls,
        chunk: DocumentChunk,
        score: float = 1.0,
        metadata: dict[str, Any] | None = None,
    ) -> EvidenceCandidate:
        return cls(
            evidence_id=f"ev_{chunk.chunk_id}",
            text=chunk.text,
            document_id=chunk.document_id,
            chunk_id=chunk.chunk_id,
            score=score,
            provenance=chunk.provenance,
            metadata=metadata or {},
            token_count=chunk.token_count,
        )


@dataclass
class CompressedContext:
    """Final compressed context passed to LLM generation."""

    prompt_context: str
    selected_evidence: list[EvidenceCandidate]
    total_tokens: int
    intent: QueryIntent
    token_budget: int
    duplicates_removed: int
    original_evidence_count: int


# --- Near-Duplicate Removal --------------------------------------------------------------------------

FORWARD_HEADER_PATTERNS = [
    re.compile(r"-+\s*Forwarded message\s*-+", re.IGNORECASE),
    re.compile(r"Begin forwarded message:", re.IGNORECASE),
    re.compile(r"\bFwd:\s*", re.IGNORECASE),
    re.compile(r"\bFW:\s*", re.IGNORECASE),
    re.compile(r"^\[[^\]]+\]\s*[^:\n]+:\s*", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^\d{1,2}[/-]\d{1,2}[/-]\d{2,4},?\s+[^-\n]+-\s*[^:\n]+:\s*", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^On\s+.*?wrote:\s*$", re.IGNORECASE | re.MULTILINE),
]


def strip_forward_headers(text: str) -> str:
    """Strips email/chat forwarding noise to reveal core message content for deduplication."""
    cleaned = text
    for pat in FORWARD_HEADER_PATTERNS:
        cleaned = pat.sub("", cleaned)
    return cleaned.strip()


def compute_shingle_set(text: str, k: int = 3) -> set[str]:
    """Computes k-word shingles for Jaccard similarity estimation."""
    words = re.findall(r"\w+", text.lower())
    if len(words) < k:
        return {" ".join(words)}
    return {" ".join(words[i : i + k]) for i in range(len(words) - k + 1)}


def jaccard_similarity(set1: set[str], set2: set[str]) -> float:
    """Calculates Jaccard similarity between two shingle sets."""
    if not set1 and not set2:
        return 1.0
    if not set1 or not set2:
        return 0.0
    intersection = len(set1.intersection(set2))
    union = len(set1.union(set2))
    return intersection / union if union > 0 else 0.0


class NearDuplicateFilter:
    """Identifies and eliminates redundant forwarded messages and near-duplicate chunks."""

    def __init__(self, similarity_threshold: float = 0.82) -> None:
        self.similarity_threshold = similarity_threshold

    def filter(self, candidates: list[EvidenceCandidate]) -> tuple[list[EvidenceCandidate], int]:
        """Filters out near-duplicates, preserving the higher-scoring primary candidate."""
        # Ensure candidates are sorted by score descending
        sorted_candidates = sorted(candidates, key=lambda c: c.score, reverse=True)
        unique_candidates: list[EvidenceCandidate] = []
        represented_shingles: list[set[str]] = []
        removed_count = 0

        for cand in sorted_candidates:
            clean_body = strip_forward_headers(cand.text)
            shingles = compute_shingle_set(clean_body)

            is_dup = False
            for rep in represented_shingles:
                sim = jaccard_similarity(shingles, rep)
                if sim >= self.similarity_threshold:
                    is_dup = True
                    break

            if is_dup:
                cand.is_duplicate = True
                removed_count += 1
            else:
                unique_candidates.append(cand)
                represented_shingles.append(shingles)

        return unique_candidates, removed_count


# --- Context Compressor -----------------------------------------------------------------------------

class ContextCompressor:
    """Compresses reranked evidence candidates into an optimal token budget while preserving evidence IDs."""

    def __init__(self, duplicate_filter: NearDuplicateFilter | None = None) -> None:
        self.duplicate_filter = duplicate_filter or NearDuplicateFilter()

    def get_budget(self, intent: QueryIntent | str) -> int:
        if isinstance(intent, str):
            try:
                intent_enum = QueryIntent(intent.lower())
            except ValueError:
                intent_enum = QueryIntent.DEFAULT
        else:
            intent_enum = intent
        return INTENT_TOKEN_BUDGETS.get(intent_enum, INTENT_TOKEN_BUDGETS[QueryIntent.DEFAULT])

    def compress(
        self,
        query: str,  # noqa: ARG002
        candidates: list[EvidenceCandidate],
        intent: QueryIntent | str = QueryIntent.DEFAULT,
        max_budget: int | None = None,
    ) -> CompressedContext:
        """Trims and formats candidates to fit within the intent budget while preserving evidence IDs."""
        if isinstance(intent, str):
            try:
                intent_enum = QueryIntent(intent.lower())
            except ValueError:
                intent_enum = QueryIntent.DEFAULT
        else:
            intent_enum = intent

        target_budget = max_budget if max_budget is not None else self.get_budget(intent_enum)
        original_count = len(candidates)

        # 1. Deduplicate
        filtered_candidates, removed_dupes = self.duplicate_filter.filter(candidates)

        # 2. Select candidates within budget
        selected: list[EvidenceCandidate] = []
        current_tokens = 0
        prompt_blocks: list[str] = []

        # Sort remaining candidates by score descending
        sorted_cands = sorted(filtered_candidates, key=lambda c: c.score, reverse=True)

        for cand in sorted_cands:
            # Format block with explicit XML citation delimiters preserving evidence_id, document_id, chunk_id
            block = (
                f'<evidence id="{cand.evidence_id}" doc="{cand.document_id}" chunk="{cand.chunk_id}">\n'
                f"{cand.text.strip()}\n"
                f"</evidence>"
            )
            block_tokens = max(1, len(block.split()) * 4 // 3)

            if current_tokens + block_tokens <= target_budget:
                selected.append(cand)
                prompt_blocks.append(block)
                current_tokens += block_tokens
            elif not selected:
                # If even the top candidate exceeds budget on its own, include truncated version
                trunc_chars = target_budget * 4
                trunc_text = cand.text[:trunc_chars] + "... [truncated]"
                trunc_block = (
                    f'<evidence id="{cand.evidence_id}" doc="{cand.document_id}" chunk="{cand.chunk_id}">\n'
                    f"{trunc_text}\n"
                    f"</evidence>"
                )
                selected.append(cand)
                prompt_blocks.append(trunc_block)
                current_tokens = target_budget
                break
            else:
                # Budget reached
                break

        full_prompt_context = "\n\n".join(prompt_blocks)

        return CompressedContext(
            prompt_context=full_prompt_context,
            selected_evidence=selected,
            total_tokens=current_tokens,
            intent=intent_enum,
            token_budget=target_budget,
            duplicates_removed=removed_dupes,
            original_evidence_count=original_count,
        )


# --- Faithfulness Check Metric ----------------------------------------------------------------------

NUMBER_PATTERN = re.compile(r"₹?\s*\d+(?:,\d+)*(?:\.\d+)?%?")


def extract_factual_tokens(text: str) -> set[str]:
    """Extracts critical factual anchors: numbers, currency amounts, percentages, and dates."""
    facts = set()
    for m in NUMBER_PATTERN.finditer(text):
        facts.add(m.group(0).replace(" ", "").lower())
    # Add capitalized named tokens (proper nouns / model numbers)
    capitalized = re.findall(r"\b[A-Z][a-zA-Z0-9_\-\.]{2,}\b", text)
    for c in capitalized:
        facts.add(c.lower())
    return facts


def evaluate_faithfulness_retention(
    top_candidates: list[EvidenceCandidate],
    compressed: CompressedContext,
) -> float:
    """Verifies that facts from selected top evidence candidates remain present in compressed context.

    Returns ratio of key factual tokens retained (0.0 to 1.0).
    """
    if not compressed.selected_evidence:
        return 0.0

    original_facts: set[str] = set()
    for cand in compressed.selected_evidence:
        original_facts.update(extract_factual_tokens(cand.text))

    if not original_facts:
        return 1.0

    compressed_facts = extract_factual_tokens(compressed.prompt_context)
    retained = original_facts.intersection(compressed_facts)
    return len(retained) / len(original_facts)


# --- Answer Caching ----------------------------------------------------------------------------------

@dataclass
class CachedAnswer:
    """Cached response for identical query, permission scope, and data version."""

    tenant_id: str
    query_hash: str
    answer_text: str
    evidence_ids: list[str]
    data_version: str
    created_at_utc: datetime
    expires_at_utc: datetime


def normalize_query_for_cache(query: str) -> str:
    """Normalizes whitespace, casing, and punctuation for query cache keying."""
    q = query.lower().strip()
    q = re.sub(r"[^\w\s]", "", q)
    return " ".join(q.split())


def compute_cache_key(
    tenant_id: str,
    permission_scope: str,
    query: str,
    data_version: str,
) -> str:
    """Computes a cryptographically secure, tenant-isolated cache key."""
    norm_q = normalize_query_for_cache(query)
    raw = f"{tenant_id}:{permission_scope}:{norm_q}:{data_version}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class AnswerCache:
    """Multi-tenant answer cache keyed on tenant, user permission scope, and dataset version."""

    def __init__(self, default_ttl_seconds: int = 86400) -> None:
        self.default_ttl = default_ttl_seconds
        # In-memory storage; easily swap to Redis or Postgres key-value store
        self._cache: dict[str, CachedAnswer] = {}

    def get(
        self,
        tenant_id: str,
        permission_scope: str,
        query: str,
        data_version: str,
    ) -> CachedAnswer | None:
        """Retrieves cached answer if valid and unexpired."""
        key = compute_cache_key(tenant_id, permission_scope, query, data_version)
        entry = self._cache.get(key)
        if not entry:
            return None

        # Verify tenant match
        if entry.tenant_id != tenant_id:
            logger.warning("Cache tenant isolation mismatch detected!")
            return None

        # Check expiry
        now = datetime.now(timezone.utc)
        if entry.expires_at_utc < now:
            del self._cache[key]
            return None

        # Verify data_version has not bumped
        if entry.data_version != data_version:
            del self._cache[key]
            return None

        return entry

    def set(
        self,
        tenant_id: str,
        permission_scope: str,
        query: str,
        data_version: str,
        answer_text: str,
        evidence_ids: list[str],
        ttl_seconds: int | None = None,
    ) -> None:
        """Stores answer in cache with TTL."""
        key = compute_cache_key(tenant_id, permission_scope, query, data_version)
        now = datetime.now(timezone.utc)
        ttl = ttl_seconds if ttl_seconds is not None else self.default_ttl
        expires_at = datetime.fromtimestamp(now.timestamp() + ttl, tz=timezone.utc)

        entry = CachedAnswer(
            tenant_id=tenant_id,
            query_hash=key,
            answer_text=answer_text,
            evidence_ids=evidence_ids,
            data_version=data_version,
            created_at_utc=now,
            expires_at_utc=expires_at,
        )
        self._cache[key] = entry

    def invalidate_tenant(self, tenant_id: str) -> int:
        """Invalidates all cached entries for a tenant upon bulk data refresh."""
        keys_to_del = [k for k, v in self._cache.items() if v.tenant_id == tenant_id]
        for k in keys_to_del:
            del self._cache[k]
        return len(keys_to_del)
