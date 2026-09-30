# Owner task: EB-36 Indexing: OpenSearch + Qdrant with ACL
from __future__ import annotations

import pytest

from indexing.indexer import ChunkAccess, ChunkIndexer, IndexingError
from indexing.opensearch import INDEX_MAPPING
from indexing.qdrant import EMBEDDING_DIM, PAYLOAD_INDEXES
from packages.permissions import PermissionsClient
from packages.permissions.filter import PermissionFilter
from retrieve import HybridRetriever
from services.normalization.models import DocumentChunk
from services.normalization.provenance.spans import ProvenanceSpan
from storage import FgaStore, LocalFgaBackend, LocalSearchBackend, LocalVectorBackend, SearchStore, TupleKey, VectorStore
from tenant_context import CrossTenantAccessError, Placement, TenantContext, TenantStatus, Tier, tenant_scope


def _ctx(tid="studio8") -> TenantContext:
    p = Placement(cell_id="c1", region="r", pg_cluster="pg", pg_database="d", object_bucket="b",
                  object_prefix=f"tenants/{tid}/", qdrant_cluster="q", qdrant_shard_key="pool", opensearch_cluster="o",
                  opensearch_index="shared", opensearch_alias="shared-alias", fga_store=f"fga-{tid}",
                  temporal_namespace="c1", temporal_queue_prefix="p", litellm_team=tid, kms_key_ref=tid)
    return TenantContext(tid, tid, TenantStatus.ACTIVE, Tier.POOL, p)


def chunk(cid, doc, text, tenant="studio8", idx=0):
    return DocumentChunk(cid, doc, tenant, idx, text, text, 10, "text", ProvenanceSpan("src", f"ref:{cid}", "h"))


def embed(texts):
    return [[1.0] + [0.0] * (EMBEDDING_DIM - 1) for _ in texts]


@pytest.fixture
def stack():
    search, vectors = SearchStore(LocalSearchBackend()), VectorStore(LocalVectorBackend())
    return ChunkIndexer(search, vectors, embed), search, vectors


def test_mapping_is_strict_and_filterable() -> None:
    props = INDEX_MAPPING["mappings"]["properties"]
    assert INDEX_MAPPING["mappings"]["dynamic"] == "strict"
    assert {"tenant_id", "project_id", "document_id"} <= {k for k, v in props.items() if v["type"] == "keyword"}
    assert {"tenant_id", "project_id", "document_id"} <= set(PAYLOAD_INDEXES)


def test_chunks_land_in_both_indexes_with_access_fields(stack) -> None:
    ix, search, vectors = stack
    with tenant_scope(_ctx()):
        n = ix.index_document([chunk("c1", "d1", "pile cap M35"), chunk("c2", "d1", "rebar schedule", idx=1)],
                              ChunkAccess("phoenix", "document", "src-9", "2026-09-30T00:00:00+00:00"))
        assert n == 2 and search.count() == 2 and vectors.count() == 2
        doc = search.search({"match_all": {}})[0]
        assert doc["project_id"] == "phoenix" and doc["document_id"] == "d1" and doc["tenant_id"] == "studio8"
        (pt, *_) = vectors.search([1.0] + [0.0] * (EMBEDDING_DIM - 1))
        assert pt.payload["project_id"] == "phoenix" and pt.payload["tenant_id"] == "studio8"


def test_idempotent_and_clean_delete(stack) -> None:
    ix, search, vectors = stack
    with tenant_scope(_ctx()):
        chunks = [chunk("c1", "d1", "a"), chunk("c2", "d1", "b", idx=1)]
        ix.index_document(chunks, ChunkAccess("phoenix", "document"))
        ix.index_document(chunks, ChunkAccess("phoenix", "document"))
        assert search.count() == 2 and vectors.count() == 2 and ix.chunk_ids("d1") == ["c1", "c2"]
        assert ix.delete_document("d1") == 2 and search.count() == 0 and vectors.count() == 0
        assert ix.delete_document("d1") == 0


def test_foreign_tenant_chunk_refused_and_nothing_written(stack) -> None:
    ix, search, vectors = stack
    with tenant_scope(_ctx()):
        with pytest.raises(CrossTenantAccessError):
            ix.index_document([chunk("c1", "d1", "ok"), chunk("c2", "d1", "x", tenant="other")], ChunkAccess("p", "document"))
        assert search.count() == 0 and vectors.count() == 0


def test_bad_embedder_and_mixed_documents_write_nothing(stack) -> None:
    ix, search, vectors = stack
    with tenant_scope(_ctx()):
        bad = ChunkIndexer(search, vectors, lambda texts: [[0.0] * 3 for _ in texts])
        with pytest.raises(IndexingError):
            bad.index_document([chunk("c1", "d1", "a")], ChunkAccess("p", "document"))
        with pytest.raises(IndexingError):
            ix.index_document([chunk("c1", "d1", "a"), chunk("c2", "d2", "b")], ChunkAccess("p", "document"))
        assert search.count() == 0 and vectors.count() == 0


def test_second_index_failure_rolls_back_the_first(stack) -> None:
    ix, search, vectors = stack
    calls = {"n": 0}
    real = search.index

    def flaky(doc_id, document):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("opensearch down")
        real(doc_id, document)

    search.index = flaky  # type: ignore[method-assign]
    with tenant_scope(_ctx()):
        with pytest.raises(RuntimeError):
            ix.index_document([chunk("c1", "d1", "a"), chunk("c2", "d1", "b", idx=1)], ChunkAccess("p", "document"))
        assert vectors.count() == 0 and search.count() == 0


def test_end_to_end_acl_two_layers(stack) -> None:
    """Index two projects; a user with access to one sees only it — filter before retrieval, re-check after."""
    ix, search, vectors = stack
    fga = FgaStore(LocalFgaBackend(), cache_ttl_seconds=0)
    with tenant_scope(_ctx()):
        ix.index_document([chunk("c-ph", "d-ph", "budget overrun on phoenix")], ChunkAccess("phoenix", "document"))
        ix.index_document([chunk("c-hb", "d-hb", "budget overrun on harbour")], ChunkAccess("harbour", "document"))
        fga.write_tuples([TupleKey("user:asha", "member", "project:phoenix"),
                          TupleKey("project:phoenix", "parent", "document:d-ph"),
                          TupleKey("project:harbour", "parent", "document:d-hb")], [])
        pf = PermissionFilter(PermissionsClient(fga))
        scope = pf.scope_for("asha")
        retriever = HybridRetriever(vector_store=vectors, search_store=search)
        hits = retriever.retrieve("budget overrun", query_vector=[1.0] + [0.0] * (EMBEDDING_DIM - 1),
                                  filter_spec=scope.filter_spec())
        # layer 1: the vector index never even returned harbour; the local lexical backend ignores filters,
        # which is exactly why layer 2 exists
        assert "d-hb" not in {c.document_id for c in vectors_only(retriever, scope)}
        allowed = pf.authorize("asha", hits)
        assert {c.document_id for c in allowed} == {"d-ph"}


def vectors_only(retriever, scope):
    return retriever._dense_search_sync([1.0] + [0.0] * (EMBEDDING_DIM - 1), scope.filter_spec(), 10)
