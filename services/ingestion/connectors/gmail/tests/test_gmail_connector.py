# Owner task: EB-31 Gmail connector
"""Unit and integration tests for Gmail connector."""

from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
import json
import pytest

from connectors_sdk import (
    ConnectorConfigError,
    Cursor,
    RecordType,
    SourceContext,
)
from connectors_sdk.errors import CredentialExpiredError, CredentialInvalidError
from services.ingestion.connectors.gmail.auth import GmailCredentials
from services.ingestion.connectors.gmail.connector import GmailConnector
from services.ingestion.connectors.gmail.mapper import GmailMapper, extract_email_address


@pytest.fixture
def source_ctx() -> SourceContext:
    return SourceContext(
        tenant_id="tenant-acme",
        source_id="gmail-sanjay",
        connector_type="gmail",
        config={
            "mailbox": "sanjayk@thekilarity.com",
            "exclude_labels": ["SPAM", "TRASH", "PROMOTIONS"],
            "exclude_senders": ["newsletter@marketing.com"],
        },
    )


def test_gmail_credentials_validation() -> None:
    # Valid OAuth2 credentials
    creds = GmailCredentials(
        auth_type="oauth2",
        mailbox="sanjayk@thekilarity.com",
        client_id="cid-123",
        client_secret="csecret-456",
        refresh_token="rtoken-789",
    )
    creds.validate()

    # Expired token without refresh token fails
    past_expiry = datetime.now(timezone.utc) - timedelta(hours=1)
    expired_creds = GmailCredentials(
        auth_type="oauth2",
        mailbox="sanjayk@thekilarity.com",
        access_token="expired-token",
        token_expiry=past_expiry,
    )
    with pytest.raises(CredentialExpiredError):
        expired_creds.validate()

    # Missing mailbox fails
    with pytest.raises(CredentialInvalidError):
        GmailCredentials(auth_type="oauth2", mailbox="").validate()

    # Service account missing info fails
    with pytest.raises(CredentialInvalidError):
        GmailCredentials(auth_type="service_account", mailbox="sanjayk@thekilarity.com").validate()

    # Valid service account
    sa_creds = GmailCredentials(
        auth_type="service_account",
        mailbox="sanjayk@thekilarity.com",
        service_account_info={"client_email": "sa@project.iam.gserviceaccount.com"},
    )
    sa_creds.validate()


def test_gmail_connector_auth_and_config(source_ctx: SourceContext) -> None:
    connector = GmailConnector()

    # Config validation
    connector.validate_config(source_ctx)

    bad_ctx = SourceContext(
        tenant_id="tenant-acme",
        source_id="src-bad",
        connector_type="gmail",
        config={},
    )
    with pytest.raises(ConnectorConfigError):
        connector.validate_config(bad_ctx)

    # Authenticate
    connector.authenticate(
        source_ctx,
        {
            "auth_type": "oauth2",
            "mailbox": "sanjayk@thekilarity.com",
            "refresh_token": "mock-refresh-token",
        },
    )


def test_gmail_connector_backfill_and_incremental_sync(source_ctx: SourceContext) -> None:
    connector = GmailConnector()
    connector.authenticate(
        source_ctx,
        {"auth_type": "oauth2", "mailbox": "sanjayk@thekilarity.com", "refresh_token": "mock-tok"},
    )

    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    msg1 = {
        "id": "msg-001",
        "threadId": "thread-001",
        "historyId": "1001",
        "internalDate": str(now_ms - 50000),
        "labelIds": ["INBOX"],
        "snippet": "First test email",
        "payload": {
            "mimeType": "text/plain",
            "headers": [
                {"name": "From", "value": "Alice <alice@partner.com>"},
                {"name": "To", "value": "Sanjay <sanjayk@thekilarity.com>"},
                {"name": "Subject", "value": "Project Clarification"},
                {"name": "Date", "value": "Wed, 30 Sep 2026 10:00:00 +0000"},
            ],
            "body": {
                "size": 25,
                "data": base64.urlsafe_b64encode(b"Hello Sanjay, here is the update.").decode("ascii"),
            },
        },
    }

    connector.set_simulated_inbox(source_ctx, [msg1])

    # Initial fetch (backfill)
    gen = connector.fetch_since(source_ctx, Cursor())
    items = []
    try:
        while True:
            items.append(next(gen))
    except StopIteration as stop:
        c1 = stop.value

    assert len(items) == 1
    assert items[0].external_id == "msg-001"
    assert c1.value["mode"] == "incremental"
    assert c1.value["history_id"] == "1001"
    assert "freshness_lag_seconds" in c1.value

    # ACL check
    acl = connector.fetch_acl(source_ctx, items[0])
    assert not acl.is_public
    assert "sanjayk@thekilarity.com" in acl.users
    assert "alice@partner.com" in acl.users

    # Normalization check
    records = connector.normalize(source_ctx, items[0], acl, raw_ref="raw/gmail/msg-001")
    assert len(records) == 1
    assert records[0].record_type == RecordType.EMAIL
    assert records[0].title == "Project Clarification"
    assert "Hello Sanjay, here is the update." in records[0].text
    assert records[0].author == "alice@partner.com"

    # Incremental sync with a second message
    msg2 = {
        "id": "msg-002",
        "threadId": "thread-001",
        "historyId": "1005",
        "internalDate": str(now_ms),
        "labelIds": ["INBOX"],
        "snippet": "Second reply",
        "payload": {
            "mimeType": "text/plain",
            "headers": [
                {"name": "From", "value": "sanjayk@thekilarity.com"},
                {"name": "To", "value": "alice@partner.com"},
                {"name": "Subject", "value": "Re: Project Clarification"},
                {"name": "Date", "value": "Wed, 30 Sep 2026 10:05:00 +0000"},
            ],
            "body": {
                "size": 15,
                "data": base64.urlsafe_b64encode(b"Got it, thanks!").decode("ascii"),
            },
        },
    }

    connector.set_simulated_inbox(source_ctx, [msg1, msg2])
    gen2 = connector.fetch_since(source_ctx, c1)
    items2 = []
    try:
        while True:
            items2.append(next(gen2))
    except StopIteration as stop:
        c2 = stop.value

    assert len(items2) == 1
    assert items2[0].external_id == "msg-002"
    assert c2.value["history_id"] == "1005"


def test_gmail_attachment_handover_to_normalization(source_ctx: SourceContext) -> None:
    connector = GmailConnector()
    connector.authenticate(
        source_ctx,
        {"auth_type": "oauth2", "mailbox": "sanjayk@thekilarity.com", "refresh_token": "mock-tok"},
    )

    pdf_sample = b"%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n>>\nendobj\ntrailer\n<<\n>>\n%%EOF"
    msg_with_att = {
        "id": "msg-att-001",
        "threadId": "thread-boq",
        "historyId": "1010",
        "internalDate": "1696070400000",
        "labelIds": ["INBOX"],
        "snippet": "Attached is the BOQ",
        "payload": {
            "mimeType": "multipart/mixed",
            "headers": [
                {"name": "From", "value": "estimator@studio8.com"},
                {"name": "To", "value": "sanjayk@thekilarity.com"},
                {"name": "Subject", "value": "Studio 8 BOQ Submission"},
            ],
            "parts": [
                {
                    "mimeType": "text/plain",
                    "body": {
                        "size": 30,
                        "data": base64.urlsafe_b64encode(b"Please review the attached BOQ.").decode("ascii"),
                    },
                },
                {
                    "mimeType": "application/pdf",
                    "filename": "HVAC_BOQ_Rev2.pdf",
                    "body": {
                        "attachmentId": "att-pdf-01",
                        "size": len(pdf_sample),
                        "data": base64.urlsafe_b64encode(pdf_sample).decode("ascii"),
                    },
                },
            ],
        },
    }

    connector.set_simulated_inbox(source_ctx, [msg_with_att])
    gen = connector.fetch_since(source_ctx, Cursor())
    item = next(gen)

    acl = connector.fetch_acl(source_ctx, item)
    records = connector.normalize(source_ctx, item, acl, raw_ref="raw/gmail/msg-att-001")

    # Should have 2 records: Email record and Attachment record
    assert len(records) == 2
    email_rec = records[0]
    att_rec = records[1]

    assert email_rec.record_type == RecordType.EMAIL
    assert email_rec.title == "Studio 8 BOQ Submission"
    assert email_rec.metadata["attachment_count"] == "1"

    assert att_rec.record_type == RecordType.FILE
    assert att_rec.title == "Attachment: HVAC_BOQ_Rev2.pdf"
    assert att_rec.parent_external_id == "msg-att-001"
    assert att_rec.metadata["filename"] == "HVAC_BOQ_Rev2.pdf"
    assert att_rec.metadata["mime_type"] == "application/pdf"


def test_gmail_consent_and_exclusion_filters(source_ctx: SourceContext) -> None:
    connector = GmailConnector()
    connector.authenticate(
        source_ctx,
        {"auth_type": "oauth2", "mailbox": "sanjayk@thekilarity.com", "refresh_token": "mock-tok"},
    )

    # 1. Message with excluded label (e.g. SPAM)
    spam_msg = {
        "id": "spam-001",
        "labelIds": ["SPAM"],
        "payload": {
            "mimeType": "text/plain",
            "headers": [
                {"name": "From", "value": "promo@spammer.com"},
                {"name": "Subject", "value": "Claim your prize!"},
            ],
            "body": {"size": 10, "data": base64.urlsafe_b64encode(b"Win a car").decode("ascii")},
        },
    }

    connector.set_simulated_inbox(source_ctx, [spam_msg])
    gen = connector.fetch_since(source_ctx, Cursor())
    item = next(gen)
    acl = connector.fetch_acl(source_ctx, item)
    records = connector.normalize(source_ctx, item, acl, raw_ref="raw/spam")
    assert len(records) == 0  # filtered out by exclude_labels

    # 2. Message from excluded sender
    sender_msg = {
        "id": "news-001",
        "labelIds": ["INBOX"],
        "payload": {
            "mimeType": "text/plain",
            "headers": [
                {"name": "From", "value": "Weekly Newsletter <newsletter@marketing.com>"},
                {"name": "Subject", "value": "Weekly digest"},
            ],
            "body": {"size": 10, "data": base64.urlsafe_b64encode(b"Weekly news").decode("ascii")},
        },
    }
    connector.set_simulated_inbox(source_ctx, [sender_msg])
    gen = connector.fetch_since(source_ctx, Cursor())
    item = next(gen)
    acl = connector.fetch_acl(source_ctx, item)
    records = connector.normalize(source_ctx, item, acl, raw_ref="raw/news")
    assert len(records) == 0  # filtered out by exclude_senders
