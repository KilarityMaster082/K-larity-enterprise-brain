"""K!larity Connector SDK — one interface for every source connector.

Owner task: EB-28 Connector SDK and source registry
See docs/borrow/BORROW_MAP.md for what was borrowed from Onyx and Activepieces.
"""

from .errors import (
    ConnectorConfigError,
    ConnectorError,
    CredentialExpiredError,
    CredentialInvalidError,
    InsufficientPermissionsError,
    RateLimitedError,
    RetryableError,
    TenantMismatchError,
)
from .interface import BaseConnector, FetchOutput
from .models import (
    SCHEMA_VERSION,
    Acl,
    Cursor,
    NormalizedRecord,
    RawItem,
    RecordType,
    SourceContext,
    SyncFailure,
)
from .raw_store import LocalRawPayloadStore, RawPayloadStore
from .ratelimit import RateLimiter
from .registry import ConnectorRegistry, default_registry, register
from .runner import RecordSink, SyncReport, run_sync
from .state import FileSourceStateStore, SourceHealth, SourceState, SourceStateStore

__all__ = [
    "SCHEMA_VERSION", "Acl", "BaseConnector", "ConnectorConfigError", "ConnectorError", "ConnectorRegistry",
    "CredentialExpiredError", "CredentialInvalidError", "Cursor", "FetchOutput", "FileSourceStateStore",
    "InsufficientPermissionsError", "LocalRawPayloadStore", "NormalizedRecord", "RateLimitedError",
    "RateLimiter", "RawItem", "RawPayloadStore", "RecordSink", "RecordType", "RetryableError",
    "SourceContext", "SourceHealth", "SourceState", "SourceStateStore", "SyncFailure", "SyncReport",
    "TenantMismatchError", "default_registry", "register", "run_sync",
]
