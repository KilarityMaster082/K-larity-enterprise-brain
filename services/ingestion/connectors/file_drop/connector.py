"""File-drop reference connector: ingests files a tenant drops into its own folder.

Owner task: EB-28 Connector SDK and source registry (reference connector; EB-35 extends it for Drive/CAD)
Borrowed from: Onyx a18fc1a backend/onyx/connectors/file/connector.py (MIT) — local file walk and
per-file document mapping. Activepieces 611db01a packages/pieces/common/src/lib/polling (MIT, A3) —
time-based cursor. Adapted: the cursor is (mtime_ns, path) so files sharing a timestamp are neither
dropped (A3 TIMEBASED filters `>` only) nor duplicated; each tenant is confined to
<root>/<tenant_id>/, symlinks and hidden files are ignored; parsing of binary formats is left to
services/normalization (EB-30) — this connector only decodes plain-text files.

Source config: {"folder": "<subfolder under the tenant root>", "batch_size": 100,
                "max_bytes": 52428800, "acl": {"is_public": false, "users": [], "groups": []}}
"""

from __future__ import annotations

import mimetypes
import os
from collections.abc import Iterator, Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from connectors_sdk import (
    Acl,
    BaseConnector,
    ConnectorConfigError,
    Cursor,
    FetchOutput,
    NormalizedRecord,
    RawItem,
    RecordType,
    SourceContext,
    SyncFailure,
    register,
)

TEXT_SUFFIXES = {".txt", ".md", ".csv", ".tsv", ".json"}
DEFAULT_BATCH = 100
DEFAULT_MAX_BYTES = 50 * 1024 * 1024


@register
class FileDropConnector(BaseConnector):
    connector_type = "file_drop"
    version = "1"

    def __init__(self, drop_root: str | os.PathLike[str] | None = None) -> None:
        root = drop_root or os.environ.get("KLARITY_FILE_DROP_ROOT")
        self.drop_root = Path(root).resolve() if root else None

    # --- config -------------------------------------------------------------------------------------
    def _folder(self, ctx: SourceContext) -> Path:
        if self.drop_root is None:
            raise ConnectorConfigError("file drop root not configured (KLARITY_FILE_DROP_ROOT)")
        tenant_root = (self.drop_root / ctx.tenant_id).resolve()
        folder = (tenant_root / str(ctx.config.get("folder", ""))).resolve()
        if folder != tenant_root and tenant_root not in folder.parents:
            raise ConnectorConfigError("folder escapes the tenant's drop root")
        if not folder.is_dir():
            raise ConnectorConfigError(f"folder does not exist: {ctx.config.get('folder', '')!r}")
        return folder

    def validate_config(self, ctx: SourceContext) -> None:
        self._folder(ctx)

    def authenticate(self, ctx: SourceContext, credentials: Mapping[str, Any]) -> None:  # noqa: ARG002
        """Local folder: nothing to authenticate. Access is scoped by tenant folder instead."""

    # --- listing ------------------------------------------------------------------------------------
    def _walk(self, folder: Path) -> Iterator[tuple[int, str, Path]]:
        for dirpath, dirnames, filenames in os.walk(folder, followlinks=False):
            dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
            for name in filenames:
                p = Path(dirpath) / name
                if name.startswith(".") or p.is_symlink() or not p.is_file():
                    continue
                yield p.stat().st_mtime_ns, p.relative_to(folder).as_posix(), p

    def list_items(self, ctx: SourceContext) -> Iterator[str]:
        for _, rel, _ in self._walk(self._folder(ctx)):
            yield rel

    # --- fetch --------------------------------------------------------------------------------------
    def fetch_since(self, ctx: SourceContext, cursor: Cursor) -> FetchOutput:
        folder = self._folder(ctx)
        batch_size = int(ctx.config.get("batch_size", DEFAULT_BATCH))
        max_bytes = int(ctx.config.get("max_bytes", DEFAULT_MAX_BYTES))
        after = (int(cursor.value.get("mtime_ns", -1)), str(cursor.value.get("path", "")))
        pending = sorted((m, rel, p) for m, rel, p in self._walk(folder) if (m, rel) > after)
        batch = pending[:batch_size]
        for mtime_ns, rel, path in batch:
            size = path.stat().st_size
            if size > max_bytes:
                yield SyncFailure(f"file larger than {max_bytes} bytes", external_id=rel, retryable=False)
                continue
            yield RawItem(
                external_id=rel,
                payload=path.read_bytes(),
                content_type=mimetypes.guess_type(rel)[0] or "application/octet-stream",
                source_updated_at=datetime.fromtimestamp(mtime_ns / 1e9, tz=timezone.utc),
                metadata={"size": str(size)},
            )
        if not batch:
            return Cursor(cursor.value, has_more=False)
        last_mtime, last_rel, _ = batch[-1]
        return Cursor({"mtime_ns": last_mtime, "path": last_rel}, has_more=len(pending) > len(batch))

    def fetch_acl(self, ctx: SourceContext, item: RawItem) -> Acl:  # noqa: ARG002
        return Acl.from_dict(ctx.config.get("acl", {}))

    def normalize(self, ctx: SourceContext, item: RawItem, acl: Acl, raw_ref: str) -> list[NormalizedRecord]:
        is_text = Path(item.external_id).suffix.lower() in TEXT_SUFFIXES
        return [self.make_record(
            ctx, item, acl, raw_ref,
            record_type=RecordType.DOCUMENT if is_text else RecordType.FILE,
            title=Path(item.external_id).name,
            text=item.payload.decode("utf-8", errors="replace") if is_text else None,
            occurred_at=item.source_updated_at,
            metadata={"path": item.external_id, "content_type": item.content_type, **item.metadata},
        )]
