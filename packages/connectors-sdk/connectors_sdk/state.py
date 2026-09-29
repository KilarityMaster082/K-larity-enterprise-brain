"""Source registry state: per-tenant source config, cursor, last sync, health and seen-item hashes.

Owner task: EB-28 Connector SDK and source registry
Borrowed from: Onyx a18fc1a backend/onyx/background/indexing/checkpointing_utils.py (MIT) — checkpoint
persisted after each batch and reloaded on the next attempt; stop reusing it after repeated no-progress
failures. Activepieces 611db01a packages/pieces/common/src/lib/polling (MIT) — cursor kept in a durable
store between polls (A3). Adapted: state keyed by (tenant_id, source_id); Postgres implementation follows
db/migrations/0002_connector_sources.sql once DB schema v1 (EB-19) and RLS (EB-20) land.
FileSourceStateStore is the development/test implementation; writes are atomic so a crash never leaves a
half-written cursor.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Protocol

from .models import Cursor, SourceContext, validate_id


class SourceHealth(str, Enum):
    NEVER_RUN = "never_run"
    OK = "ok"
    DEGRADED = "degraded"      # sync finished with item failures
    FAILING = "failing"        # last sync aborted
    AUTH_ERROR = "auth_error"  # tenant must re-authorise; runner will not retry


@dataclass
class SourceState:
    tenant_id: str
    source_id: str
    connector_type: str
    cursor: Cursor | None = None
    health: SourceHealth = SourceHealth.NEVER_RUN
    last_sync_started_at: str | None = None
    last_sync_finished_at: str | None = None
    last_error: str | None = None
    consecutive_failures: int = 0
    items_seen: int = 0

    @classmethod
    def new(cls, ctx: SourceContext) -> SourceState:
        return cls(ctx.tenant_id, ctx.source_id, ctx.connector_type)

    def to_json(self) -> str:
        d: dict[str, Any] = asdict(self)
        d["cursor"] = self.cursor.to_json() if self.cursor else None
        d["health"] = self.health.value
        return json.dumps(d, sort_keys=True)

    @classmethod
    def from_json(cls, s: str) -> SourceState:
        d = json.loads(s)
        d["cursor"] = Cursor.from_json(d["cursor"]) if d.get("cursor") else None
        d["health"] = SourceHealth(d["health"])
        return cls(**d)


@dataclass(frozen=True)
class ItemState:
    content_hash: str
    raw_ref: str


class SourceStateStore(Protocol):
    def load(self, tenant_id: str, source_id: str) -> SourceState | None: ...
    def save(self, state: SourceState) -> None: ...
    def get_item(self, tenant_id: str, source_id: str, external_id: str) -> ItemState | None: ...
    def put_item(self, tenant_id: str, source_id: str, external_id: str, item: ItemState) -> None: ...
    def item_ids(self, tenant_id: str, source_id: str) -> set[str]: ...


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


class FileSourceStateStore:
    """Development/test store. Rewrites items.json per item, so it is not meant for large sources."""

    def __init__(self, root: str | os.PathLike[str]) -> None:
        self.root = Path(root)
        self._items: dict[tuple[str, str], dict[str, ItemState]] = {}

    def _dir(self, tenant_id: str, source_id: str) -> Path:
        return self.root / validate_id("tenant_id", tenant_id) / validate_id("source_id", source_id)

    def load(self, tenant_id: str, source_id: str) -> SourceState | None:
        p = self._dir(tenant_id, source_id) / "state.json"
        return SourceState.from_json(p.read_text()) if p.exists() else None

    def save(self, state: SourceState) -> None:
        _atomic_write(self._dir(state.tenant_id, state.source_id) / "state.json", state.to_json())

    def _load_items(self, tenant_id: str, source_id: str) -> dict[str, ItemState]:
        key = (tenant_id, source_id)
        if key not in self._items:
            p = self._dir(tenant_id, source_id) / "items.json"
            raw = json.loads(p.read_text()) if p.exists() else {}
            self._items[key] = {k: ItemState(**v) for k, v in raw.items()}
        return self._items[key]

    def get_item(self, tenant_id: str, source_id: str, external_id: str) -> ItemState | None:
        return self._load_items(tenant_id, source_id).get(external_id)

    def put_item(self, tenant_id: str, source_id: str, external_id: str, item: ItemState) -> None:
        items = self._load_items(tenant_id, source_id)
        items[external_id] = item
        _atomic_write(self._dir(tenant_id, source_id) / "items.json",
                      json.dumps({k: asdict(v) for k, v in items.items()}, sort_keys=True))

    def item_ids(self, tenant_id: str, source_id: str) -> set[str]:
        return set(self._load_items(tenant_id, source_id))
