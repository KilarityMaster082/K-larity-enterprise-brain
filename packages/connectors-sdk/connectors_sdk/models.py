"""Typed, versioned records exchanged between connectors and the ingestion pipeline.

Owner task: EB-28 Connector SDK and source registry
Borrowed from: Onyx a18fc1a backend/onyx/connectors/models.py (MIT) — Document/ConnectorCheckpoint/
ConnectorFailure shapes; backend/onyx/access/utils.py prefixed ACL tokens (O5).
Adapted: tenant_id and source_id are mandatory on every record; SHA-256 content hash (Onyx uses MD5);
stdlib dataclasses instead of pydantic; Onyx-specific fields (hierarchy nodes, image summaries) dropped.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any

SCHEMA_VERSION = "1.0"

_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")


def validate_id(kind: str, value: str) -> str:
    """Tenant and source ids end up in storage keys and paths, so they are strictly shaped."""
    if not isinstance(value, str) or not _ID_RE.match(value):
        raise ValueError(f"invalid {kind}: {value!r}")
    return value


def sha256_hex(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


class RecordType(str, Enum):
    DOCUMENT = "document"
    FILE = "file"
    EMAIL = "email"
    MESSAGE = "message"
    SHEET_ROW = "sheet_row"


@dataclass(frozen=True)
class SourceContext:
    """Passed to every connector call. A connector never sees data for any other tenant."""

    tenant_id: str
    source_id: str
    connector_type: str
    config: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        validate_id("tenant_id", self.tenant_id)
        validate_id("source_id", self.source_id)
        if not self.connector_type:
            raise ValueError("connector_type is required")


@dataclass(frozen=True)
class Acl:
    """Who may see an item at the source. Rendered as prefixed tokens for index filters (EB-42)."""

    is_public: bool = False
    users: frozenset[str] = frozenset()
    groups: frozenset[str] = frozenset()

    def tokens(self) -> list[str]:
        out = ["public"] if self.is_public else []
        out += [f"user:{u.lower()}" for u in self.users]
        out += [f"group:{g}" for g in self.groups]
        return sorted(out)

    def to_dict(self) -> dict[str, Any]:
        return {"is_public": self.is_public, "users": sorted(self.users), "groups": sorted(self.groups)}

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> Acl:
        return cls(bool(d.get("is_public", False)), frozenset(d.get("users", ())), frozenset(d.get("groups", ())))


@dataclass(frozen=True)
class RawItem:
    """One item exactly as the source returned it. Stored verbatim before normalisation."""

    external_id: str
    payload: bytes
    content_type: str
    source_updated_at: datetime | None = None
    metadata: Mapping[str, str] = field(default_factory=dict)

    @property
    def content_hash(self) -> str:
        return sha256_hex(self.payload)


@dataclass(frozen=True)
class Cursor:
    """Opaque, JSON-serialisable sync position. `has_more` asks the runner for another batch."""

    value: Mapping[str, Any] = field(default_factory=dict)
    has_more: bool = False
    version: int = 1

    def to_json(self) -> str:
        return json.dumps({"value": dict(self.value), "has_more": self.has_more, "version": self.version},
                          sort_keys=True)

    @classmethod
    def from_json(cls, s: str) -> Cursor:
        d = json.loads(s)
        return cls(value=d.get("value", {}), has_more=bool(d.get("has_more", False)), version=int(d.get("version", 1)))


@dataclass(frozen=True)
class NormalizedRecord:
    """The one shape every connector produces. Downstream (normalization, indexing) reads only this."""

    tenant_id: str
    source_id: str
    external_id: str
    record_type: RecordType
    title: str
    text: str | None
    content_hash: str
    raw_ref: str
    acl: Acl
    url: str | None = None
    author: str | None = None
    occurred_at: datetime | None = None
    source_updated_at: datetime | None = None
    parent_external_id: str | None = None
    metadata: Mapping[str, str] = field(default_factory=dict)
    schema_version: str = SCHEMA_VERSION

    def __post_init__(self) -> None:
        validate_id("tenant_id", self.tenant_id)
        validate_id("source_id", self.source_id)
        if not self.external_id:
            raise ValueError("external_id is required")

    @property
    def record_id(self) -> str:
        """Stable id within a tenant; sinks must upsert on (tenant_id, record_id)."""
        return f"{self.source_id}:{self.external_id}"


@dataclass(frozen=True)
class SyncFailure:
    """A single item or range that could not be fetched; the sync continues (Onyx ConnectorFailure)."""

    message: str
    external_id: str | None = None
    retryable: bool = True
