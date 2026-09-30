# Owner task: EB-31 Gmail connector
"""Gmail message and attachment mapper transforming raw mail payloads into NormalizedRecords."""

from __future__ import annotations

import base64
import email
from email.header import decode_header
import json
import logging
import re
from typing import Any

from connectors_sdk.models import Acl, NormalizedRecord, RawItem, RecordType, SourceContext
from services.normalization.models import ParsedDocument
from services.normalization.parsers.docling_parser import DoclingParser

logger = logging.getLogger(__name__)


def decode_mime_header(header_val: str | None) -> str:
    """Decodes RFC 2047 MIME-encoded headers."""
    if not header_val:
        return ""
    parts = decode_header(header_val)
    decoded = []
    for text, enc in parts:
        if isinstance(text, bytes):
            decoded.append(text.decode(enc or "utf-8", errors="replace"))
        else:
            decoded.append(str(text))
    return "".join(decoded).strip()


def extract_email_address(s: str) -> str:
    """Extracts bare email address from 'Name <user@domain.com>' format."""
    m = re.search(r"<([^>]+)>", s)
    if m:
        return m.group(1).strip().lower()
    return s.strip().lower()


class GmailMapper:
    """Transforms raw Gmail items into primary email and attachment NormalizedRecords.

    Extracts threads, message headers, body text, and routes attachments to services/normalization.
    """

    def __init__(self, docling_parser: DoclingParser | None = None) -> None:
        self.doc_parser = docling_parser or DoclingParser()

    def parse_raw_item(self, item: RawItem) -> dict[str, Any]:
        """Parses a RawItem containing JSON or RFC 822 bytes into a structured message dict."""
        try:
            # Case 1: Gmail API message JSON
            data = json.loads(item.payload.decode("utf-8"))
            if isinstance(data, dict) and "id" in data:
                return self._parse_api_json(data)
        except Exception:
            pass

        # Case 2: RFC 822 raw email bytes
        return self._parse_rfc822(item.payload, item.external_id)

    def _parse_api_json(self, msg_json: dict[str, Any]) -> dict[str, Any]:
        headers_map: dict[str, str] = {}
        payload = msg_json.get("payload", {})
        for h in payload.get("headers", []):
            name = h.get("name", "").lower()
            headers_map[name] = decode_mime_header(h.get("value", ""))

        body_text = ""
        attachments: list[dict[str, Any]] = []

        def _walk_parts(part: dict[str, Any]) -> None:
            nonlocal body_text
            mime_type = part.get("mimeType", "")
            filename = part.get("filename", "")
            body = part.get("body", {})

            if filename:
                # Attachment part
                att_data = None
                raw_b64 = body.get("data")
                if raw_b64:
                    try:
                        att_data = base64.urlsafe_b64decode(raw_b64)
                    except Exception:
                        pass
                attachments.append({
                    "filename": filename,
                    "mime_type": mime_type,
                    "size": body.get("size", len(att_data) if att_data else 0),
                    "attachment_id": body.get("attachmentId", f"att-{len(attachments)+1}"),
                    "data": att_data,
                })
            elif mime_type == "text/plain":
                raw_b64 = body.get("data")
                if raw_b64:
                    try:
                        body_text += base64.urlsafe_b64decode(raw_b64).decode("utf-8", errors="replace") + "\n"
                    except Exception:
                        pass
            elif mime_type == "text/html" and not body_text:
                raw_b64 = body.get("data")
                if raw_b64:
                    try:
                        html_str = base64.urlsafe_b64decode(raw_b64).decode("utf-8", errors="replace")
                        body_text = re.sub(r"<[^>]+>", " ", html_str)
                    except Exception:
                        pass

            for subpart in part.get("parts", []):
                _walk_parts(subpart)

        _walk_parts(payload)

        return {
            "message_id": msg_json["id"],
            "thread_id": msg_json.get("threadId", msg_json["id"]),
            "history_id": msg_json.get("historyId"),
            "internal_date": int(msg_json.get("internalDate", 0)),
            "label_ids": msg_json.get("labelIds", []),
            "from": headers_map.get("from", ""),
            "to": headers_map.get("to", ""),
            "cc": headers_map.get("cc", ""),
            "subject": headers_map.get("subject", "(No Subject)"),
            "date": headers_map.get("date", ""),
            "body": body_text.strip() or msg_json.get("snippet", ""),
            "snippet": msg_json.get("snippet", ""),
            "attachments": attachments,
        }

    def _parse_rfc822(self, raw_bytes: bytes, external_id: str) -> dict[str, Any]:
        msg = email.message_from_bytes(raw_bytes)
        headers_map: dict[str, str] = {
            k.lower(): decode_mime_header(v) for k, v in msg.items()
        }

        body_text = ""
        attachments: list[dict[str, Any]] = []

        if msg.is_multipart():
            for part in msg.walk():
                content_disp = part.get("Content-Disposition", "")
                filename = part.get_filename()
                if filename or "attachment" in content_disp:
                    payload = part.get_payload(decode=True)
                    attachments.append({
                        "filename": decode_mime_header(filename or f"attachment-{len(attachments)+1}"),
                        "mime_type": part.get_content_type(),
                        "size": len(payload) if payload else 0,
                        "attachment_id": f"att-{len(attachments)+1}",
                        "data": payload,
                    })
                elif part.get_content_type() == "text/plain":
                    payload = part.get_payload(decode=True)
                    if payload:
                        body_text += payload.decode("utf-8", errors="replace") + "\n"
                elif part.get_content_type() == "text/html" and not body_text:
                    payload = part.get_payload(decode=True)
                    if payload:
                        html_str = payload.decode("utf-8", errors="replace")
                        body_text = re.sub(r"<[^>]+>", " ", html_str)
        else:
            payload = msg.get_payload(decode=True)
            if payload:
                body_text = payload.decode("utf-8", errors="replace")

        return {
            "message_id": external_id,
            "thread_id": headers_map.get("thread-index", external_id),
            "history_id": None,
            "internal_date": 0,
            "label_ids": ["INBOX"],
            "from": headers_map.get("from", ""),
            "to": headers_map.get("to", ""),
            "cc": headers_map.get("cc", ""),
            "subject": headers_map.get("subject", "(No Subject)"),
            "date": headers_map.get("date", ""),
            "body": body_text.strip(),
            "snippet": body_text[:200],
            "attachments": attachments,
        }

    def map_to_records(
        self,
        ctx: SourceContext,
        item: RawItem,
        acl: Acl,
        raw_ref: str,
    ) -> list[NormalizedRecord]:
        """Maps a raw Gmail item to email and attachment NormalizedRecords."""
        data = self.parse_raw_item(item)
        message_id = data["message_id"]

        # Check consent and exclusion filters from config
        exclude_labels = {lbl.upper() for lbl in ctx.config.get("exclude_labels", ["SPAM", "TRASH", "PROMOTIONS"])}
        if any(lbl.upper() in exclude_labels for lbl in data["label_ids"]):
            logger.debug("Skipping message %s matching excluded label", message_id)
            return []

        sender_email = extract_email_address(data["from"])
        exclude_senders = {s.lower() for s in ctx.config.get("exclude_senders", [])}
        if sender_email in exclude_senders:
            logger.debug("Skipping message %s from excluded sender %s", message_id, sender_email)
            return []

        records: list[NormalizedRecord] = []

        # 1. Primary Email Record
        email_record = NormalizedRecord(
            tenant_id=ctx.tenant_id,
            source_id=ctx.source_id,
            external_id=message_id,
            record_type=RecordType.EMAIL,
            title=data["subject"] or f"Email from {data['from']}",
            text=f"Subject: {data['subject']}\nFrom: {data['from']}\nTo: {data['to']}\nDate: {data['date']}\n\n{data['body']}",
            content_hash=item.content_hash,
            raw_ref=raw_ref,
            acl=acl,
            author=sender_email,
            parent_external_id=data["thread_id"],
            metadata={
                "thread_id": data["thread_id"],
                "from": data["from"],
                "to": data["to"],
                "cc": data["cc"],
                "date": data["date"],
                "attachment_count": str(len(data["attachments"])),
                "labels": ",".join(data["label_ids"]),
            },
        )
        records.append(email_record)

        # 2. Attachment Records (parsed via services/normalization)
        for att in data["attachments"]:
            att_id = att["attachment_id"]
            att_fn = att["filename"]
            att_bytes = att.get("data")
            att_ext_id = f"{message_id}:{att_id}"

            parsed_att_text = ""
            if att_bytes:
                try:
                    parsed_doc = self.doc_parser.parse(
                        content=att_bytes,
                        filename=att_fn,
                        tenant_id=ctx.tenant_id,
                        document_id=att_ext_id,
                        content_type=att.get("mime_type"),
                    )
                    parsed_att_text = parsed_doc.text
                except Exception as exc:
                    logger.warning("Failed parsing email attachment %s: %s", att_fn, exc)
                    parsed_att_text = f"[Attachment: {att_fn} ({att.get('mime_type')})]"

            att_record = NormalizedRecord(
                tenant_id=ctx.tenant_id,
                source_id=ctx.source_id,
                external_id=att_ext_id,
                record_type=RecordType.FILE,
                title=f"Attachment: {att_fn}",
                text=parsed_att_text or f"[Attachment: {att_fn}]",
                content_hash=item.content_hash,
                raw_ref=raw_ref,
                acl=acl,
                author=sender_email,
                parent_external_id=message_id,
                metadata={
                    "filename": att_fn,
                    "mime_type": att.get("mime_type", ""),
                    "size": str(att.get("size", 0)),
                    "parent_message_id": message_id,
                },
            )
            records.append(att_record)

        return records
