"""Runs one sync for one source: fetch → dedupe by content hash → store raw → ACL → normalise → sink.

Owner task: EB-28 Connector SDK and source registry
Borrowed from: Onyx a18fc1a backend/onyx/connectors/connector_runner.py and
background/indexing/checkpointing_utils.py (MIT) — drive the checkpoint generator batch by batch and
persist the checkpoint after each batch. Activepieces 611db01a server/api/src/app/trigger/dedupe-service.ts
(MIT, A4) — drop duplicates before they reach the flow. Adapted: dedupe is by (tenant, source,
external_id, SHA-256 of payload) and durable, not a 30-second Redis key; every record's tenant_id is
checked against the run's tenant before anything is written.

Delivery guarantee: a crash mid-batch re-fetches that batch from the last saved cursor. Items already
written are skipped by their stored hash; an item written to the sink but not yet marked in the state
store is written again, so sinks MUST upsert on (tenant_id, record_id).

Temporal activities (EB-29) call `run_sync`; this module has no scheduling or retry of its own.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

from .errors import AUTH_ERRORS, ConnectorError, TenantMismatchError
from .interface import BaseConnector
from .models import Cursor, NormalizedRecord, RawItem, SourceContext, SyncFailure
from .raw_store import RawPayloadStore
from .state import ItemState, SourceHealth, SourceState, SourceStateStore, utcnow_iso


class RecordSink(Protocol):
    def write(self, records: Sequence[NormalizedRecord]) -> None:
        """Must be idempotent: upsert on (tenant_id, record_id)."""
        ...


@dataclass
class SyncReport:
    batches: int = 0
    fetched: int = 0
    new: int = 0
    changed: int = 0
    unchanged: int = 0
    records_written: int = 0
    failures: list[SyncFailure] = field(default_factory=list)
    missing_at_source: list[str] = field(default_factory=list)
    finished: bool = False  # False when stopped by max_batches with more to fetch


def _drain(gen: Any) -> tuple[list[RawItem | SyncFailure], Cursor]:
    out: list[RawItem | SyncFailure] = []
    while True:
        try:
            out.append(next(gen))
        except StopIteration as stop:
            if not isinstance(stop.value, Cursor):
                raise ConnectorError("fetch_since must return a Cursor") from None
            return out, stop.value


def run_sync(
    connector: BaseConnector,
    ctx: SourceContext,
    credentials: Mapping[str, Any],
    state_store: SourceStateStore,
    raw_store: RawPayloadStore,
    sink: RecordSink,
    *,
    max_batches: int | None = None,
    reconcile_deletions: bool = False,
) -> SyncReport:
    if ctx.connector_type != connector.connector_type:
        raise ConnectorError(f"source is {ctx.connector_type!r}, connector is {connector.connector_type!r}")
    state = state_store.load(ctx.tenant_id, ctx.source_id) or SourceState.new(ctx)
    if state.connector_type != ctx.connector_type:
        raise ConnectorError("stored source state belongs to a different connector_type")

    report = SyncReport()
    state.last_sync_started_at = utcnow_iso()
    state_store.save(state)
    try:
        connector.validate_config(ctx)
        connector.authenticate(ctx, credentials)
        cursor = state.cursor or connector.initial_cursor(ctx)
        while True:
            # A batch is drained before any write so a connector error cannot leave half a batch behind
            # the saved cursor; items are then committed one by one.
            batch, next_cursor = _drain(connector.fetch_since(ctx, cursor))
            for entry in batch:
                if isinstance(entry, SyncFailure):
                    report.failures.append(entry)
                    continue
                _ingest(connector, ctx, entry, state_store, raw_store, sink, report)
            cursor = next_cursor
            state.cursor = cursor
            report.batches += 1
            state_store.save(state)  # checkpoint: survives restart
            if not cursor.has_more:
                report.finished = True
                break
            if max_batches is not None and report.batches >= max_batches:
                break
        if reconcile_deletions and report.finished:
            known = state_store.item_ids(ctx.tenant_id, ctx.source_id)
            report.missing_at_source = sorted(known - set(connector.list_items(ctx)))
    except AUTH_ERRORS as exc:
        _finish(state, state_store, SourceHealth.AUTH_ERROR, f"{type(exc).__name__}: {exc}")
        raise
    except Exception as exc:
        _finish(state, state_store, SourceHealth.FAILING, f"{type(exc).__name__}: {exc}")
        raise
    health = SourceHealth.DEGRADED if report.failures else SourceHealth.OK
    _finish(state, state_store, health, report.failures[0].message if report.failures else None, report)
    return report


def _ingest(connector: BaseConnector, ctx: SourceContext, item: RawItem, state_store: SourceStateStore,
            raw_store: RawPayloadStore, sink: RecordSink, report: SyncReport) -> None:
    report.fetched += 1
    digest = item.content_hash
    prev = state_store.get_item(ctx.tenant_id, ctx.source_id, item.external_id)
    if prev is not None and prev.content_hash == digest:
        report.unchanged += 1
        return
    raw_ref = raw_store.put(ctx.tenant_id, ctx.source_id, digest, item.payload, item.content_type)
    acl = connector.fetch_acl(ctx, item)
    records = connector.normalize(ctx, item, acl, raw_ref)
    for r in records:
        if r.tenant_id != ctx.tenant_id or r.source_id != ctx.source_id:
            raise TenantMismatchError(f"record {r.record_id} not scoped to {ctx.tenant_id}/{ctx.source_id}")
    sink.write(records)
    state_store.put_item(ctx.tenant_id, ctx.source_id, item.external_id, ItemState(digest, raw_ref))
    report.records_written += len(records)
    if prev is None:
        report.new += 1
    else:
        report.changed += 1


def _finish(state: SourceState, store: SourceStateStore, health: SourceHealth, error: str | None,
            report: SyncReport | None = None) -> None:
    state.health = health
    state.last_error = error
    state.last_sync_finished_at = utcnow_iso()
    state.consecutive_failures = state.consecutive_failures + 1 if health in (
        SourceHealth.FAILING, SourceHealth.AUTH_ERROR) else 0
    if report is not None:
        state.items_seen += report.new
    store.save(state)
