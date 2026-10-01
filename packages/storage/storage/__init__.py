"""K!larity store wrappers. Every store here subclasses tenant_context.TenantScopedStore.

Owner task: EB-85 Tenant registry and control plane
"""

from .credential_store import (
    ConcurrentUpdateError,
    CredentialBackend,
    CredentialError,
    CredentialMeta,
    CredentialNeedsReauthError,
    CredentialNotFoundError,
    CredentialStatus,
    CredentialStore,
    FileCredentialBackend,
    PostgresCredentialBackend,
    Secret,
)
from .envelope import (
    DecryptionError,
    DevKeyring,
    Envelope,
    EnvelopeError,
    KeyProvider,
    KeyUnavailableError,
    KmsKeyProvider,
)
from .database_session import bind_session_tenant, create_app_engine
from .fga_store import FgaBackend, FgaStore, LocalFgaBackend, TupleKey
from .object_store import LocalObjectBackend, ObjectBackend, ObjectStore, S3ObjectBackend, check_key
from .record_store import RecordConflictError, SqlRecordStore
from .search_store import LocalSearchBackend, SearchBackend, SearchStore
from .vector_store import LocalVectorBackend, VectorBackend, VectorPoint, VectorStore

__all__ = [
    "ConcurrentUpdateError", "CredentialBackend", "CredentialError", "CredentialMeta",
    "CredentialNeedsReauthError", "CredentialNotFoundError", "CredentialStatus", "CredentialStore",
    "DecryptionError", "DevKeyring", "Envelope", "EnvelopeError", "FgaBackend", "FgaStore", "FileCredentialBackend",
    "KeyProvider", "KeyUnavailableError", "KmsKeyProvider", "LocalFgaBackend", "LocalObjectBackend",
    "LocalSearchBackend", "LocalVectorBackend", "ObjectBackend", "ObjectStore", "PostgresCredentialBackend",
    "RecordConflictError", "S3ObjectBackend", "SearchBackend", "SearchStore", "Secret", "SqlRecordStore", "TupleKey", "VectorBackend", "VectorPoint",
    "VectorStore", "bind_session_tenant", "check_key", "create_app_engine",
]
