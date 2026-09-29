"""Owner task: EB-28 Connector SDK and source registry — SDK unit tests."""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from typing import Any

import pytest

from connectors_sdk import (
    Acl,
    BaseConnector,
    ConnectorError,
    ConnectorRegistry,
    CredentialInvalidError,
    Cursor,
    FetchOutput,
    FileSourceStateStore,
    LocalRawPayloadStore,
    NormalizedRecord,
    RateLimitedError,
    RateLimiter,
    RawItem,
    RecordType,
    SourceContext,
    SourceHealth,
    SyncFailure,
    TenantMismatchError,
    run_sync,
)

CTX = SourceContext("acme", "inbox-1", "fake")


class FakeConnector(BaseConnector):
    """Serves an in-memory list of (id, payload) in order, `batch` at a time."""

    connector_type = "fake"

    def __init__(self, items: list[tuple[str, bytes]], batch: int = 2, crash_after: int | None = None,
                 tenant_override: str | None = None, fail_ids: set[str] | None = None) -> None:
        self.items, self.batch, self.crash_after = items, batch, crash_after
        self.tenant_override, self.fail_ids = tenant_override, fail_ids or set()
        self.cursors_seen: list[dict[str, Any]] = []
        self.normalized = 0

    def authenticate(self, ctx: SourceContext, credentials: Mapping[str, Any]) -> None:
        if credentials.get("token") != "ok":
            raise CredentialInvalidError("bad token")

    def list_items(self, ctx: SourceContext) -> Iterator[str]:
        return iter(i for i, _ in self.items)

    def fetch_since(self, ctx: SourceContext, cursor: Cursor) -> FetchOutput:
        self.cursors_seen.append(dict(cursor.value))
        pos = int(cursor.value.get("pos", 0))
        chunk = self.items[pos:pos + self.batch]
        for ext_id, payload in chunk:
            if ext_id in self.fail_ids:
                yield SyncFailure("boom", external_id=ext_id)
            else:
                yield RawItem(ext_id, payload, "text/plain")
        new_pos = pos + len(chunk)
        return Cursor({"pos": new_pos}, has_more=new_pos < len(self.items))

    def fetch_acl(self, ctx: SourceContext, item: RawItem) -> Acl:
        return Acl(groups=frozenset({"project-phoenix"}))

    def normalize(self, ctx: SourceContext, item: RawItem, acl: Acl, raw_ref: str) -> list[NormalizedRecord]:
        if self.crash_after is not None and self.normalized >= self.crash_after:
            raise RuntimeError("worker killed")
        self.normalized += 1
        if self.tenant_override:
            ctx = SourceContext(self.tenant_override, ctx.source_id, ctx.connector_type)
        return [self.make_record(ctx, item, acl, raw_ref, record_type=RecordType.MESSAGE,
                                 title=item.external_id, text=item.payload.decode())]


class ListSink:
    def __init__(self) -> None:
        self.records: dict[tuple[str, str], NormalizedRecord] = {}
        self.writes = 0

    def write(self, records: list[NormalizedRecord]) -> None:
        for r in records:
            self.writes += 1
            self.records[(r.tenant_id, r.record_id)] = r


@pytest.fixture
def stores(tmp_path):
    return FileSourceStateStore(tmp_path / "state"), LocalRawPayloadStore(tmp_path / "raw")


ITEMS = [(f"m{i}", f"message {i}".encode()) for i in range(5)]
CREDS = {"token": "ok"}


# --- models ---------------------------------------------------------------------------------------
def test_context_rejects_bad_ids():
    for bad in ("", "../x", "a/b", " acme"):
        with pytest.raises(ValueError):
            SourceContext(bad, "s", "fake")


def test_acl_tokens_are_prefixed_and_sorted():
    acl = Acl(is_public=False, users=frozenset({"Ravi@Studio8.in"}), groups=frozenset({"finance"}))
    assert acl.tokens() == ["group:finance", "user:ravi@studio8.in"]
    assert Acl.from_dict(acl.to_dict()) == acl


def test_cursor_json_roundtrip():
    c = Cursor({"pos": 3, "page": "abc"}, has_more=True)
    assert Cursor.from_json(c.to_json()) == c


def test_record_requires_tenant():
    with pytest.raises(ValueError):
        NormalizedRecord("", "s", "x", RecordType.FILE, "t", None, "sha256:0", "raw://a/s/x", Acl())


# --- registry -------------------------------------------------------------------------------------
def test_registry_accepts_complete_connector_only():
    reg = ConnectorRegistry()
    reg.register(FakeConnector)
    assert reg.get("fake") is FakeConnector and reg.types() == ["fake"]

    class Half(BaseConnector):
        connector_type = "half"

        def authenticate(self, ctx, credentials): ...

    with pytest.raises(TypeError, match="missing"):
        reg.register(Half)

    class Dup(FakeConnector):
        pass

    with pytest.raises(ValueError, match="already registered"):
        reg.register(Dup)
    with pytest.raises(KeyError):
        reg.get("nope")


# --- runner ---------------------------------------------------------------------------------------
def test_full_sync_writes_records_raw_and_cursor(stores):
    state_store, raw_store = stores
    sink = ListSink()
    report = run_sync(FakeConnector(ITEMS), CTX, CREDS, state_store, raw_store, sink)
    assert (report.new, report.records_written, report.batches, report.finished) == (5, 5, 3, True)
    rec = sink.records[("acme", "inbox-1:m0")]
    assert raw_store.get("acme", rec.raw_ref) == b"message 0"
    assert rec.acl.tokens() == ["group:project-phoenix"]
    state = state_store.load("acme", "inbox-1")
    assert state.cursor.value == {"pos": 5} and state.health is SourceHealth.OK and state.items_seen == 5


def test_content_hash_dedupe_skips_unchanged_and_detects_changes(stores):
    state_store, raw_store = stores
    run_sync(FakeConnector(ITEMS), CTX, CREDS, state_store, raw_store, ListSink())
    state = state_store.load("acme", "inbox-1")
    state.cursor = None  # force a full re-read
    state_store.save(state)
    items = list(ITEMS)
    items[2] = ("m2", b"message 2 (edited)")
    sink = ListSink()
    report = run_sync(FakeConnector(items), CTX, CREDS, state_store, raw_store, sink)
    assert (report.unchanged, report.changed, report.new, sink.writes) == (4, 1, 0, 1)


def test_cursor_survives_restart(tmp_path):
    first_sink = ListSink()
    run_sync(FakeConnector(ITEMS), CTX, CREDS, FileSourceStateStore(tmp_path / "s"),
             LocalRawPayloadStore(tmp_path / "r"), first_sink, max_batches=1)
    assert len(first_sink.records) == 2

    # new process: fresh store objects on the same directories, fresh connector
    resumed = FakeConnector(ITEMS)
    second_sink = ListSink()
    report = run_sync(resumed, CTX, CREDS, FileSourceStateStore(tmp_path / "s"),
                      LocalRawPayloadStore(tmp_path / "r"), second_sink)
    assert resumed.cursors_seen[0] == {"pos": 2}
    assert report.new == 3 and set(second_sink.records).isdisjoint(first_sink.records)


def test_crash_mid_batch_resumes_without_duplicates(stores):
    state_store, raw_store = stores
    sink = ListSink()
    with pytest.raises(RuntimeError, match="worker killed"):
        run_sync(FakeConnector(ITEMS, batch=5, crash_after=3), CTX, CREDS, state_store, raw_store, sink)
    assert state_store.load("acme", "inbox-1").health is SourceHealth.FAILING
    assert state_store.load("acme", "inbox-1").cursor is None  # batch never checkpointed
    report = run_sync(FakeConnector(ITEMS, batch=5), CTX, CREDS, state_store, raw_store, sink)
    assert (report.unchanged, report.new) == (3, 2)
    assert sink.writes == 5 and len(sink.records) == 5
    assert state_store.load("acme", "inbox-1").consecutive_failures == 0


class HardKill(BaseException):
    """Stands in for SIGKILL / OOM: no except-handler in the runner gets to run."""


def test_hard_kill_keeps_cursor_of_completed_batches(tmp_path):
    class Killed(FakeConnector):
        def normalize(self, ctx, item, acl, raw_ref):
            if item.external_id == "m3":
                raise HardKill
            return super().normalize(ctx, item, acl, raw_ref)

    with pytest.raises(HardKill):
        run_sync(Killed(ITEMS), CTX, CREDS, FileSourceStateStore(tmp_path / "s"),
                 LocalRawPayloadStore(tmp_path / "r"), ListSink())
    # batch 1 (m0, m1) was checkpointed before batch 2 died on m3
    assert FileSourceStateStore(tmp_path / "s").load("acme", "inbox-1").cursor.value == {"pos": 2}
    resumed, sink = FakeConnector(ITEMS), ListSink()
    report = run_sync(resumed, CTX, CREDS, FileSourceStateStore(tmp_path / "s"),
                      LocalRawPayloadStore(tmp_path / "r"), sink)
    assert resumed.cursors_seen[0] == {"pos": 2}
    assert (report.unchanged, report.new) == (1, 2)  # m2 was already committed before the kill


def test_record_for_another_tenant_is_refused(stores):
    state_store, raw_store = stores
    sink = ListSink()
    with pytest.raises(TenantMismatchError):
        run_sync(FakeConnector(ITEMS, tenant_override="other"), CTX, CREDS, state_store, raw_store, sink)
    assert sink.writes == 0


def test_bad_credentials_mark_auth_error(stores):
    state_store, raw_store = stores
    with pytest.raises(CredentialInvalidError):
        run_sync(FakeConnector(ITEMS), CTX, {"token": "nope"}, state_store, raw_store, ListSink())
    state = state_store.load("acme", "inbox-1")
    assert state.health is SourceHealth.AUTH_ERROR and "bad token" in state.last_error


def test_item_failures_degrade_but_do_not_abort(stores):
    state_store, raw_store = stores
    report = run_sync(FakeConnector(ITEMS, fail_ids={"m3"}), CTX, CREDS, state_store, raw_store, ListSink())
    assert report.new == 4 and [f.external_id for f in report.failures] == ["m3"]
    assert state_store.load("acme", "inbox-1").health is SourceHealth.DEGRADED


def test_reconcile_reports_items_missing_at_source(stores):
    state_store, raw_store = stores
    run_sync(FakeConnector(ITEMS), CTX, CREDS, state_store, raw_store, ListSink())
    state = state_store.load("acme", "inbox-1")
    state.cursor = None
    state_store.save(state)
    report = run_sync(FakeConnector(ITEMS[1:]), CTX, CREDS, state_store, raw_store, ListSink(),
                      reconcile_deletions=True)
    assert report.missing_at_source == ["m0"]


def test_fetch_since_must_return_cursor(stores):
    class NoCursor(FakeConnector):
        def fetch_since(self, ctx, cursor):
            yield RawItem("x", b"x", "text/plain")

    with pytest.raises(ConnectorError, match="must return a Cursor"):
        run_sync(NoCursor([]), CTX, CREDS, *stores, ListSink())


def test_state_is_isolated_per_tenant(stores):
    state_store, raw_store = stores
    run_sync(FakeConnector(ITEMS), CTX, CREDS, state_store, raw_store, ListSink())
    assert state_store.load("other", "inbox-1") is None
    ref = state_store.get_item("acme", "inbox-1", "m0").raw_ref
    with pytest.raises(TenantMismatchError):
        raw_store.get("other", ref)


# --- rate limiter ---------------------------------------------------------------------------------
def test_rate_limiter_waits_then_gives_up():
    now = [0.0]
    sleeps: list[float] = []
    rl = RateLimiter(2, 10.0, sleep_time=1, backoff=2, max_sleeps=2,
                     clock=lambda: now[0], sleep=sleeps.append)
    rl.acquire()
    rl.acquire()
    with pytest.raises(RateLimitedError):
        rl.acquire()
    assert sleeps == [1, 2]
    now[0] = 11.0  # window passed
    rl.acquire()
