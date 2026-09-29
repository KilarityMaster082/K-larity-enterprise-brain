"""The single interface every K!larity connector implements.

Owner task: EB-28 Connector SDK and source registry
Borrowed from: Onyx a18fc1a backend/onyx/connectors/interfaces.py (MIT) — CheckpointedConnector:
`load_from_checkpoint` yields documents/failures and *returns* the next checkpoint (`yield from`).
Adapted: Onyx's Load/Poll/Slim/Event/PermSync class family is collapsed into one ABC with five methods;
every method takes a SourceContext carrying tenant_id; credentials are handed in already decrypted by the
control plane (EB-85) and are never persisted by a connector (Risk R-12). Onyx's ee perm-sync hooks and
Redis key prefixes are not carried over.
"""

from __future__ import annotations

import abc
from collections.abc import Generator, Iterator, Mapping
from typing import Any, ClassVar

from .models import Acl, Cursor, NormalizedRecord, RawItem, RecordType, SourceContext, SyncFailure

FetchOutput = Generator[RawItem | SyncFailure, None, Cursor]


class BaseConnector(abc.ABC):
    """Implement the five abstract methods; the runner handles storage, dedupe, cursors and health.

    Contract:
    - `fetch_since` yields RawItems (or SyncFailures) for one bounded batch and returns the next Cursor.
      Set `has_more=True` on the returned cursor when another batch is waiting.
    - Items must be yielded in cursor order so that resuming from a saved cursor loses nothing.
    - Connectors are stateless between calls; all state lives in the Cursor.
    """

    connector_type: ClassVar[str]
    version: ClassVar[str] = "1"

    @abc.abstractmethod
    def authenticate(self, ctx: SourceContext, credentials: Mapping[str, Any]) -> None:
        """Validate and hold credentials for this run. Raise CredentialInvalidError etc. on failure."""

    @abc.abstractmethod
    def list_items(self, ctx: SourceContext) -> Iterator[str]:
        """Every external_id currently at the source (cheap listing, used to detect deletions)."""

    @abc.abstractmethod
    def fetch_since(self, ctx: SourceContext, cursor: Cursor) -> FetchOutput:
        """Yield items changed after `cursor`; return the cursor to resume from."""

    @abc.abstractmethod
    def fetch_acl(self, ctx: SourceContext, item: RawItem) -> Acl:
        """Who may see this item at the source."""

    @abc.abstractmethod
    def normalize(self, ctx: SourceContext, item: RawItem, acl: Acl, raw_ref: str) -> list[NormalizedRecord]:
        """Map one raw item to one or more NormalizedRecords (use `make_record`)."""

    def initial_cursor(self, ctx: SourceContext) -> Cursor:  # noqa: ARG002
        return Cursor()

    def validate_config(self, ctx: SourceContext) -> None:  # noqa: ARG002
        """Raise ConnectorConfigError if ctx.config is unusable. Default: accept."""

    def make_record(self, ctx: SourceContext, item: RawItem, acl: Acl, raw_ref: str, *,
                    record_type: RecordType, title: str, text: str | None,
                    external_id: str | None = None, **fields: Any) -> NormalizedRecord:
        """Fill the tenant/source/hash/provenance fields so connectors only supply content."""
        return NormalizedRecord(
            tenant_id=ctx.tenant_id,
            source_id=ctx.source_id,
            external_id=external_id or item.external_id,
            record_type=record_type,
            title=title,
            text=text,
            content_hash=item.content_hash,
            raw_ref=raw_ref,
            acl=acl,
            source_updated_at=fields.pop("source_updated_at", item.source_updated_at),
            **fields,
        )
