# Owner task: EB-29 Temporal ingestion pipeline
"""Unit tests for Temporal ingestion workflows, activities, retry policies, and worker crash recovery."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any
import pytest

from connectors_sdk import (
    BaseConnector,
    Cursor,
    FileSourceStateStore,
    LocalRawPayloadStore,
    RawItem,
    SourceContext,
    SyncFailure,
)
from tenant_context import (
    Placement,
    TenantContext,
    TenantStatus,
    Tier,
    tenant_scope,
)

from services.ingestion.workflows import (
    ActivityRetryPolicy,
    DeadLetterStore,
    IngestSourceWorkflow,
    IngestionScheduleRegistry,
    IngestionWorker,
    SourceCategory,
    chunk_doc_activity,
    embed_chunks_activity,
    extract_events_activity,
    get_schedule_for_connector,
    index_chunks_activity,
    make_idempotency_key,
    parse_doc_activity,
    resolve_entities_activity,
)


def _make_tenant_ctx(tenant_id: str) -> TenantContext:
    p = Placement(
        cell_id="c1",
        region="ap-south-2",
        pg_cluster="pg",
        pg_database="brain",
        object_bucket="b",
        object_prefix=f"tenants/{tenant_id}/",
        qdrant_cluster="q",
        qdrant_shard_key=tenant_id,
        opensearch_cluster="os",
        opensearch_index=f"docs-{tenant_id}",
        opensearch_alias=f"tenant-{tenant_id}",
        fga_store=f"fga-{tenant_id}",
        temporal_namespace="c1",
        temporal_queue_prefix="pool",
        litellm_team=f"tenant-{tenant_id}",
        kms_key_ref=f"alias/klarity-tenant-{tenant_id}",
    )
    return TenantContext(
        tenant_id=tenant_id,
        slug=tenant_id,
        status=TenantStatus.ACTIVE,
        tier=Tier.POOL,
        placement=p,
    )


class MockConnector(BaseConnector):
    """Test connector serving deterministic raw items."""

    connector_type = "mock"

    def __init__(self, items: list[tuple[str, bytes]]) -> None:
        self.items = items

    def authenticate(self, ctx: SourceContext, credentials: Any) -> None:
        pass

    def list_items(self, ctx: SourceContext) -> Iterator[str]:
        return iter(ext_id for ext_id, _ in self.items)

    def fetch_since(self, ctx: SourceContext, cursor: Cursor) -> Iterator[RawItem]:
        pos = int(cursor.value.get("pos", 0))
        for ext_id, payload in self.items[pos:]:
            yield RawItem(
                external_id=ext_id,
                payload=payload,
                content_type="text/plain",
            )

    def fetch_acl(self, ctx: SourceContext, item: RawItem) -> Any:
        return None

    def normalize(self, ctx: SourceContext, item: RawItem, acl: Any, raw_ref: str) -> list[Any]:
        return []


def test_activities_all_stages() -> None:
    """Subtask 1: Activity per step: parse -> chunk -> embed -> index -> extract_events -> resolve_entities."""
    sample_text = (
        "Project Phoenix Contract Agreement.\n\n"
        "Approved payment of INR 50,00,000 for foundation milestone.\n\n"
        "All structural works conform to NBC 2016 safety specifications."
    )
    raw_bytes = sample_text.encode("utf-8")
    content_hash = "sha256:1122334455667788"

    # 1. Parse
    parsed = parse_doc_activity(
        tenant_id="studio8",
        source_id="src-1",
        external_id="doc-101",
        content_hash=content_hash,
        payload_bytes=raw_bytes,
    )
    assert parsed.tenant_id == "studio8"
    assert "Project Phoenix" in parsed.text_content
    assert parsed.metadata["byte_size"] == len(raw_bytes)

    # 2. Chunk
    chunks = chunk_doc_activity(parsed, max_chunk_chars=100)
    assert len(chunks) >= 2
    assert chunks[0].tenant_id == "studio8"

    # 3. Embed
    embedded = embed_chunks_activity(chunks)
    assert len(embedded) == len(chunks)
    assert len(embedded[0].embedding) == 8

    # 4. Index
    indexed = index_chunks_activity(embedded)
    assert indexed.chunks_indexed == len(chunks)
    assert indexed.doc_id == "doc-101"

    # 5. Extract events
    events = extract_events_activity(chunks)
    assert len(events) >= 1
    event_types = {e.event_type for e in events}
    assert "approval" in event_types or "financial_transaction" in event_types

    # 6. Resolve entities
    entities = resolve_entities_activity(events, chunks)
    assert any(ent.name == "Project" for ent in entities)


def test_activity_retry_policy_and_timeouts() -> None:
    """Subtask 2: Verify retry policy exponential backoff and timeouts."""
    policy = ActivityRetryPolicy(
        initial_interval_seconds=1.0,
        backoff_coefficient=2.0,
        maximum_interval_seconds=10.0,
        maximum_attempts=4,
    )

    assert policy.delay_for_attempt(1) == 1.0
    assert policy.delay_for_attempt(2) == 2.0
    assert policy.delay_for_attempt(3) == 4.0
    assert policy.delay_for_attempt(4) == 8.0
    assert policy.delay_for_attempt(5) == 10.0  # Capped at maximum_interval_seconds


def test_idempotency_keys_deduplicate(tmp_path: Any) -> None:
    """Subtask 3: Idempotency keys (tenant, source, ref, hash) prevent duplicate indexing."""
    state_store = FileSourceStateStore(tmp_path / "state")
    dead_letter = DeadLetterStore()
    workflow = IngestSourceWorkflow(dead_letter_store=dead_letter)

    items = [("doc-1", b"First doc content"), ("doc-2", b"Second doc content")]
    connector = MockConnector(items)
    ctx = SourceContext(tenant_id="studio8", source_id="box-drive", connector_type="mock")

    # First run: both items processed
    res1 = workflow.run(ctx=ctx, connector=connector, cursor=Cursor(), state_store=state_store)
    assert res1.items_seen == 2
    assert res1.items_processed == 2
    assert res1.items_skipped == 0

    # Second run: identical items skipped via idempotency/hash
    res2 = workflow.run(ctx=ctx, connector=connector, cursor=Cursor(), state_store=state_store)
    assert res2.items_seen == 2
    assert res2.items_processed == 0
    assert res2.items_skipped == 2
    assert len(dead_letter.list_for_tenant("studio8")) == 0


def test_dead_letter_table_and_admin_list() -> None:
    """Subtask 4: Failed items land in dead-letter table with administrative listing."""
    dead_letter = DeadLetterStore()
    workflow = IngestSourceWorkflow(dead_letter_store=dead_letter)

    items = [
        ("doc-good", b"Valid document content"),
        ("doc-bad", b"Poisoned item payload"),
    ]
    connector = MockConnector(items)
    ctx = SourceContext(tenant_id="studio8", source_id="inbox", connector_type="mock")

    # Simulate parse failure on doc-bad
    fail_stages = {"parse": {"doc-bad"}}
    res = workflow.run(
        ctx=ctx,
        connector=connector,
        cursor=Cursor(),
        fail_at_stage=fail_stages,
    )

    assert res.items_seen == 2
    assert res.items_processed == 1
    assert res.items_failed == 1

    # Verify dead-letter table
    dl_items = dead_letter.list_for_tenant("studio8", source_id="inbox")
    assert len(dl_items) == 1
    failed_item = dl_items[0]
    assert failed_item.item_ref == "doc-bad"
    assert failed_item.stage == "parse"
    assert "Simulated parse failure" in failed_item.error_message
    assert not failed_item.resolved

    # Admin resolves the failure
    resolved = dead_letter.resolve("studio8", failed_item.id, resolved_by="admin@studio8.io", notes="Handled manually")
    assert resolved
    assert failed_item.resolved is True
    assert len(dead_letter.list_for_tenant("studio8", unresolved_only=True)) == 0


def test_schedules_chat_mail_vs_files() -> None:
    """Subtask 5: 5 min chat/mail, hourly files."""
    registry = IngestionScheduleRegistry()

    # Chat connectors -> 5 min (300s, */5 * * * *)
    sched_gmail = registry.register("studio8", "gmail-src", "gmail")
    assert sched_gmail.category == SourceCategory.CHAT_MAIL
    assert sched_gmail.interval_seconds == 300
    assert sched_gmail.cron_expression == "*/5 * * * *"

    sched_whatsapp = registry.register("studio8", "wa-src", "whatsapp_cloud")
    assert sched_whatsapp.category == SourceCategory.CHAT_MAIL
    assert sched_whatsapp.interval_seconds == 300

    # File storage connectors -> hourly (3600s, 0 * * * *)
    sched_drop = registry.register("studio8", "drop-src", "file_drop")
    assert sched_drop.category == SourceCategory.FILE_STORAGE
    assert sched_drop.interval_seconds == 3600
    assert sched_drop.cron_expression == "0 * * * *"

    sched_drive = registry.register("studio8", "drive-src", "google_drive")
    assert sched_drive.category == SourceCategory.FILE_STORAGE
    assert sched_drive.interval_seconds == 3600


def test_kill_worker_mid_run_resumes_without_duplicates(tmp_path: Any) -> None:
    """Subtask 6: Acceptance criterion: killing worker mid-run resumes without duplicates."""
    state_store = FileSourceStateStore(tmp_path / "state")
    dead_letter = DeadLetterStore()
    tenant = _make_tenant_ctx("studio8")
    ctx = SourceContext(tenant_id="studio8", source_id="file-vault", connector_type="mock")

    # 5 items to sync
    items = [(f"doc-{i}", f"Project document body {i}".encode()) for i in range(1, 6)]
    connector = MockConnector(items)

    worker1 = IngestionWorker(dead_letter_store=dead_letter)

    # Simulate worker crash after item 2
    with pytest.raises(InterruptedError):
        worker1.execute_sync_job(
            tenant=tenant,
            ctx=ctx,
            connector=connector,
            cursor=Cursor({"pos": 0}),
            state_store=state_store,
            crash_after_item=2,
        )

    assert worker1.stats.jobs_interrupted == 1
    # Items 1 and 2 were seen and recorded
    assert state_store.get_item("studio8", "file-vault", "doc-1") is not None
    assert state_store.get_item("studio8", "file-vault", "doc-2") is not None
    assert state_store.get_item("studio8", "file-vault", "doc-3") is None

    # Worker restart: new worker instance
    worker2 = IngestionWorker(dead_letter_store=dead_letter)
    res = worker2.execute_sync_job(
        tenant=tenant,
        ctx=ctx,
        connector=connector,
        cursor=Cursor({"pos": 0}),
        state_store=state_store,
    )

    # In second run: 2 items skipped (doc-1 and doc-2), 3 items processed (doc-3, doc-4, doc-5)
    assert res.items_seen == 5
    assert res.items_skipped == 2
    assert res.items_processed == 3
    assert res.items_failed == 0

    # Total unique items seen across both runs = 5, duplicates = 0
    assert len(state_store.item_ids("studio8", "file-vault")) == 5
