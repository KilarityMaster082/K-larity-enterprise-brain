"""Owner task: EB-28 Connector SDK and source registry — file-drop reference connector tests."""

from __future__ import annotations

import os

import pytest

from connectors.file_drop.connector import FileDropConnector
from connectors_sdk import (
    ConnectorConfigError,
    FileSourceStateStore,
    LocalRawPayloadStore,
    RecordType,
    SourceContext,
    default_registry,
    run_sync,
)


class Sink:
    def __init__(self) -> None:
        self.records = {}

    def write(self, records) -> None:
        for r in records:
            self.records[r.external_id] = r


def _write(path, data: bytes, mtime_ns: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    os.utime(path, ns=(mtime_ns, mtime_ns))


@pytest.fixture
def env(tmp_path):
    root = tmp_path / "drop"
    folder = root / "acme" / "phoenix"
    folder.mkdir(parents=True)
    ctx = SourceContext("acme", "drop-1", "file_drop",
                        {"folder": "phoenix", "batch_size": 2, "acl": {"groups": ["project-phoenix"]}})
    stores = (FileSourceStateStore(tmp_path / "state"), LocalRawPayloadStore(tmp_path / "raw"))
    return FileDropConnector(root), ctx, folder, stores


def test_registered():
    assert default_registry.get("file_drop") is FileDropConnector


def test_ingests_text_and_binary_with_acl(env):
    conn, ctx, folder, stores = env
    _write(folder / "notes.md", b"# Site visit\nSlab poured", 1_000)
    _write(folder / "drawings" / "A-101.pdf", b"%PDF-1.7 ...", 2_000)
    sink = Sink()
    report = run_sync(conn, ctx, {}, *stores, sink)
    assert report.new == 2
    md, pdf = sink.records["notes.md"], sink.records["drawings/A-101.pdf"]
    assert md.record_type is RecordType.DOCUMENT and "Slab poured" in md.text
    assert pdf.record_type is RecordType.FILE and pdf.text is None
    assert md.acl.tokens() == ["group:project-phoenix"] and md.tenant_id == "acme"


def test_files_with_identical_mtime_are_not_lost_across_batches(env):
    conn, ctx, folder, stores = env
    for name in ("a.txt", "b.txt", "c.txt"):
        _write(folder / name, name.encode(), 5_000)  # same timestamp, batch_size=2
    sink = Sink()
    report = run_sync(conn, ctx, {}, *stores, sink)
    assert sorted(sink.records) == ["a.txt", "b.txt", "c.txt"] and report.batches == 2


def test_incremental_picks_up_new_and_edited_files_only(env):
    conn, ctx, folder, stores = env
    _write(folder / "a.txt", b"v1", 1_000)
    _write(folder / "b.txt", b"b", 1_100)
    run_sync(conn, ctx, {}, *stores, Sink())
    _write(folder / "a.txt", b"v2", 3_000)
    _write(folder / "c.txt", b"c", 3_100)
    sink = Sink()
    report = run_sync(conn, ctx, {}, *stores, sink)
    assert (report.new, report.changed, sorted(sink.records)) == (1, 1, ["a.txt", "c.txt"])


def test_touch_without_change_is_deduped(env):
    conn, ctx, folder, stores = env
    _write(folder / "a.txt", b"same", 1_000)
    run_sync(conn, ctx, {}, *stores, Sink())
    os.utime(folder / "a.txt", ns=(9_000, 9_000))
    report = run_sync(conn, ctx, {}, *stores, Sink())
    assert (report.fetched, report.unchanged, report.records_written) == (1, 1, 0)


def test_folder_cannot_escape_tenant_root(env, tmp_path):
    conn, ctx, folder, stores = env
    (tmp_path / "drop" / "other").mkdir()
    for bad in ("../../other", "/etc"):
        with pytest.raises(ConnectorConfigError):
            conn.validate_config(SourceContext("acme", "drop-1", "file_drop", {"folder": bad}))


def test_symlinks_and_hidden_files_are_ignored(env, tmp_path):
    conn, ctx, folder, stores = env
    secret = tmp_path / "drop" / "other" / "secret.txt"
    _write(secret, b"other tenant", 1_000)
    (folder / "link.txt").symlink_to(secret)
    _write(folder / ".DS_Store", b"x", 1_000)
    _write(folder / "ok.txt", b"ok", 1_000)
    assert list(conn.list_items(ctx)) == ["ok.txt"]


def test_oversized_file_is_a_failure_not_an_abort(env):
    conn, ctx, folder, stores = env
    ctx = SourceContext(ctx.tenant_id, ctx.source_id, ctx.connector_type, {**ctx.config, "max_bytes": 3})
    _write(folder / "big.txt", b"too big", 1_000)
    _write(folder / "ok.txt", b"ok", 2_000)
    report = run_sync(conn, ctx, {}, *stores, Sink())
    assert report.new == 1 and [f.external_id for f in report.failures] == ["big.txt"]
