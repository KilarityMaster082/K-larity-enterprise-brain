# Owner task: EB-31 Gmail connector
"""Gmail OAuth2 and service account authentication with encrypted credential storage."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
import logging
from typing import Any

from connectors_sdk.errors import CredentialExpiredError, CredentialInvalidError

logger = logging.getLogger(__name__)

GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"


@dataclass(frozen=True)
class GmailCredentials:
    """Decrypted in-memory credentials for Gmail API access.

    Supports both OAuth2 (User authorization) and Service Account (Domain-Wide Delegation).
    """

    auth_type: str  # "oauth2" or "service_account"
    mailbox: str  # e.g. "sanjayk@thekilarity.com"
    client_id: str | None = None
    client_secret: str | None = None
    refresh_token: str | None = None
    access_token: str | None = None
    token_expiry: datetime | None = None
    service_account_info: Mapping[str, Any] | None = None

    def validate(self) -> None:
        """Validates credential completeness."""
        if not self.mailbox or "@" not in self.mailbox:
            raise CredentialInvalidError("valid mailbox email is required")

        if self.auth_type == "oauth2":
            if not self.refresh_token and not self.access_token:
                raise CredentialInvalidError("OAuth2 credentials must contain refresh_token or access_token")
            if self.token_expiry and self.token_expiry < datetime.now(timezone.utc) and not self.refresh_token:
                raise CredentialExpiredError("access_token has expired and no refresh_token provided")
        elif self.auth_type == "service_account":
            if not self.service_account_info:
                raise CredentialInvalidError("service_account_info is required for service_account auth")
        else:
            raise CredentialInvalidError(f"unsupported auth_type {self.auth_type!r}")

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> GmailCredentials:
        expiry_val = data.get("token_expiry")
        expiry_dt = None
        if isinstance(expiry_val, datetime):
            expiry_dt = expiry_val
        elif isinstance(expiry_val, str):
            try:
                expiry_dt = datetime.fromisoformat(expiry_val)
            except ValueError:
                pass

        creds = cls(
            auth_type=str(data.get("auth_type", "oauth2")),
            mailbox=str(data.get("mailbox", "")).strip().lower(),
            client_id=data.get("client_id"),
            client_secret=data.get("client_secret"),
            refresh_token=data.get("refresh_token"),
            access_token=data.get("access_token"),
            token_expiry=expiry_dt,
            service_account_info=data.get("service_account_info"),
        )
        creds.validate()
        return creds
