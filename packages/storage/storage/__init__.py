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
from .database_session import bind_session_tenant
from .object_store import LocalObjectBackend, ObjectBackend, ObjectStore, S3ObjectBackend, check_key
from .search_store import LocalSearchBackend, SearchBackend, SearchStore
from .vector_store import LocalVectorBackend, VectorBackend, VectorPoint, VectorStore

__all__ = [
    "ConcurrentUpdateError", "CredentialBackend", "CredentialError", "CredentialMeta",
    "CredentialNeedsReauthError", "CredentialNotFoundError", "CredentialStatus", "CredentialStore",
    "DecryptionError", "DevKeyring", "Envelope", "EnvelopeError", "FileCredentialBackend", "KeyProvider",
    "KeyUnavailableError", "KmsKeyProvider", "LocalObjectBackend", "LocalSearchBackend", "LocalVectorBackend",
    "ObjectBackend", "ObjectStore", "PostgresCredentialBackend", "S3ObjectBackend", "SearchBackend", "SearchStore",
    "Secret", "VectorBackend", "VectorPoint", "VectorStore", "bind_session_tenant", "check_key",
]
