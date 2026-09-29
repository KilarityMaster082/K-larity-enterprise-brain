"""Connector error taxonomy. Retryable vs permanent decides whether the pipeline retries or disables a source.

Owner task: EB-28 Connector SDK and source registry
Borrowed from: Onyx a18fc1a backend/onyx/connectors/exceptions.py (MIT) — credential/permission classes.
The retryable/permanent split is K!larity's own: Activepieces A8 retries every failure, which would hammer
a source with a revoked credential. Backoff itself belongs to the Temporal retry policy (EB-29).
"""

from __future__ import annotations


class ConnectorError(Exception):
    retryable = False


class ConnectorConfigError(ConnectorError):
    """Source configuration is invalid; fix the config, retrying will not help."""


class CredentialInvalidError(ConnectorError):
    """Credential rejected by the source."""


class CredentialExpiredError(ConnectorError):
    """Credential expired; needs re-authorisation by the tenant."""


class InsufficientPermissionsError(ConnectorError):
    """Credential lacks the scopes the connector needs."""


class RetryableError(ConnectorError):
    """Transient failure (network, 5xx); safe to retry the batch."""

    retryable = True


class RateLimitedError(RetryableError):
    def __init__(self, message: str = "rate limited", retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class TenantMismatchError(ConnectorError):
    """A connector produced or requested data for a tenant other than the one it runs for."""


AUTH_ERRORS = (CredentialInvalidError, CredentialExpiredError, InsufficientPermissionsError)
