# Owner task: EB-32 WhatsApp chat-export parser
"""WhatsApp export parser supporting Android and iOS formats with IST timestamps and media attachment handling."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import io
import logging
import re
from typing import Any
import zipfile

from connectors_sdk.models import sha256_hex

logger = logging.getLogger(__name__)

# Indian Standard Time (UTC+05:30)
IST = timezone(datetime.now(timezone.utc).astimezone().utcoffset() or timezone.utc.utcoffset(None) or timezone.utc)
try:
    from zoneinfo import ZoneInfo
    IST_ZONE = ZoneInfo("Asia/Kolkata")
except Exception:
    IST_ZONE = timezone(datetime.now().astimezone().utcoffset() or timezone.utc)

# Regex patterns for Android and iOS chat formats
# Android format:
# 25/09/26, 14:32 - Sanjay: Hello
# 25/09/2026, 2:32 pm - Sanjay: Hello
# 25/09/2026, 14:32:10 - Sanjay: Hello
ANDROID_LINE_RE = re.compile(
    r"^(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[APap][Mm])?)\s+-\s+(.+)$"
)

# iOS format:
# [25/09/26, 14:32:15] Sanjay: Hello
# [25/09/2026, 2:32:15 PM] Sanjay: Hello
# Note: iOS exports often have Unicode Left-To-Right Mark (\u200e)
IOS_LINE_RE = re.compile(
    r"^\[\u200e?(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[APap][Mm])?)\u200e?\]\s+(.+)$"
)

SYSTEM_PATTERNS = [
    re.compile(r"messages and calls are end-to-end encrypted", re.IGNORECASE),
    re.compile(r"created group", re.IGNORECASE),
    re.compile(r"added\s+", re.IGNORECASE),
    re.compile(r"removed\s+", re.IGNORECASE),
    re.compile(r"left\s*$", re.IGNORECASE),
    re.compile(r"changed the subject to", re.IGNORECASE),
    re.compile(r"changed the group description", re.IGNORECASE),
    re.compile(r"changed this group's icon", re.IGNORECASE),
    re.compile(r"security code changed", re.IGNORECASE),
]

DELETED_PATTERNS = [
    re.compile(r"this message was deleted", re.IGNORECASE),
    re.compile(r"you deleted this message", re.IGNORECASE),
]

# Media attachment patterns:
# Android: "filename.pdf (file attached)" or "<Media omitted>"
# iOS: "<attached: 00000001-PHOTO.jpg>" or "image omitted"
ANDROID_ATTACHMENT_RE = re.compile(r"^(.*?)\s*\(file attached\)$", re.IGNORECASE)
IOS_ATTACHMENT_RE = re.compile(r"^<attached:\s*(.+?)>$", re.IGNORECASE)


@dataclass
class ChatAttachment:
    """Media file extracted from WhatsApp zip export."""

    filename: str
    data: bytes
    mime_type: str
    size: int
    content_hash: str


@dataclass
class ChatMessage:
    """Individual parsed chat message."""

    message_id: str
    timestamp: datetime
    sender: str
    text: str
    raw_text: str
    is_system: bool = False
    is_deleted: bool = False
    attachment_filename: str | None = None
    media: ChatAttachment | None = None


@dataclass
class ParsedChatExport:
    """Full parsed export from a WhatsApp zip or text file."""

    group_name: str
    messages: list[ChatMessage] = field(default_factory=list)
    attachments: dict[str, ChatAttachment] = field(default_factory=dict)
    participants: set[str] = field(default_factory=set)


def parse_timestamp(date_str: str, time_str: str) -> datetime:
    """Parses date and time strings commonly found in Indian/International WhatsApp exports."""
    # Clean up any non-breaking spaces or unicode marks
    date_str = date_str.replace("\u200e", "").replace("\u202f", " ").strip()
    time_str = time_str.replace("\u200e", "").replace("\u202f", " ").strip().lower()

    # Normalize separator
    date_str = date_str.replace("-", "/")

    # Determine date format components
    parts = date_str.split("/")
    if len(parts) != 3:
        raise ValueError(f"Invalid date string: {date_str}")

    day, month, year = int(parts[0]), int(parts[1]), int(parts[2])
    if year < 100:
        year += 2000

    # Determine 12h vs 24h
    is_pm = "pm" in time_str
    is_am = "am" in time_str
    time_clean = time_str.replace("pm", "").replace("am", "").strip()

    t_parts = time_clean.split(":")
    hour = int(t_parts[0])
    minute = int(t_parts[1])
    second = int(t_parts[2]) if len(t_parts) > 2 else 0

    if is_pm and hour < 12:
        hour += 12
    elif is_am and hour == 12:
        hour = 0

    try:
        dt = datetime(year, month, day, hour, minute, second, tzinfo=IST_ZONE)
    except Exception:
        # Fallback if month/day were in US order MM/DD/YYYY
        dt = datetime(year, day, month, hour, minute, second, tzinfo=IST_ZONE)

    return dt


def detect_mime_type(filename: str) -> str:
    """Infers MIME type from attachment filename."""
    lower = filename.lower()
    if lower.endswith(".pdf"):
        return "application/pdf"
    elif lower.endswith(".xlsx") or lower.endswith(".xls"):
        return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    elif lower.endswith(".docx") or lower.endswith(".doc"):
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    elif lower.endswith(".jpg") or lower.endswith(".jpeg"):
        return "image/jpeg"
    elif lower.endswith(".png"):
        return "image/png"
    elif lower.endswith(".dxf"):
        return "image/vnd.dxf"
    elif lower.endswith(".dwg"):
        return "image/vnd.dwg"
    elif lower.endswith(".opus") or lower.endswith(".ogg"):
        return "audio/ogg"
    elif lower.endswith(".mp4"):
        return "video/mp4"
    return "application/octet-stream"


class WhatsAppExportParser:
    """Parses WhatsApp export zip files and raw text transcripts into structured records."""

    def parse_zip(self, zip_bytes: bytes, group_name_fallback: str = "WhatsApp Group") -> ParsedChatExport:
        """Extracts transcript and all media attachments from export zip."""
        attachments: dict[str, ChatAttachment] = {}
        chat_text = ""
        inferred_group_name = group_name_fallback

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            namelist = zf.namelist()

            # Find chat text file: usually _chat.txt (iOS) or "WhatsApp Chat with <name>.txt" (Android)
            chat_filename = None
            for name in namelist:
                basename = name.split("/")[-1]
                if basename == "_chat.txt" or (basename.startswith("WhatsApp Chat") and basename.endswith(".txt")):
                    chat_filename = name
                    # Extract group name from "WhatsApp Chat with <name>.txt"
                    if basename.startswith("WhatsApp Chat with "):
                        inferred_group_name = basename[len("WhatsApp Chat with ") : -4].strip()
                    break

            if not chat_filename:
                # Look for any .txt file
                for name in namelist:
                    if name.endswith(".txt") and not name.startswith("__MACOSX"):
                        chat_filename = name
                        break

            if not chat_filename:
                raise ValueError("No WhatsApp chat transcript (.txt) found in zip archive")

            with zf.open(chat_filename) as f:
                chat_text = f.read().decode("utf-8", errors="replace")

            # Extract media attachments
            for name in namelist:
                if name == chat_filename or name.endswith("/") or name.startswith("__MACOSX"):
                    continue
                basename = name.split("/")[-1]
                if not basename:
                    continue
                file_data = zf.read(name)
                mime = detect_mime_type(basename)
                chash = sha256_hex(file_data)
                attachments[basename] = ChatAttachment(
                    filename=basename,
                    data=file_data,
                    mime_type=mime,
                    size=len(file_data),
                    content_hash=chash,
                )

        parsed_export = self.parse_text(chat_text, group_name=inferred_group_name)
        # Link attachments to messages
        for msg in parsed_export.messages:
            if msg.attachment_filename and msg.attachment_filename in attachments:
                msg.media = attachments[msg.attachment_filename]

        parsed_export.attachments = attachments
        return parsed_export

    def parse_text(self, text: str, group_name: str = "WhatsApp Chat") -> ParsedChatExport:
        """Parses lines into individual messages, supporting multi-line continuations and system events."""
        messages: list[ChatMessage] = []
        participants: set[str] = set()

        raw_lines = text.splitlines()
        current_msg: dict[str, Any] | None = None

        def _flush_current() -> None:
            nonlocal current_msg
            if not current_msg:
                return

            text_body = current_msg["text"].strip()
            sender = current_msg["sender"]
            is_system = current_msg["is_system"]
            is_deleted = False

            # Check deleted message patterns
            for dp in DELETED_PATTERNS:
                if dp.search(text_body):
                    is_deleted = True
                    break

            # Check attachment references
            att_filename: str | None = None
            m_att_ios = IOS_ATTACHMENT_RE.match(text_body)
            if m_att_ios:
                att_filename = m_att_ios.group(1).strip()
            else:
                m_att_android = ANDROID_ATTACHMENT_RE.match(text_body)
                if m_att_android:
                    att_filename = m_att_android.group(1).strip()

            ts_iso = current_msg["timestamp"].isoformat()
            raw_id_str = f"{ts_iso}_{sender}_{text_body}"
            msg_id = f"wa_{sha256_hex(raw_id_str.encode('utf-8'))[:16]}"

            msg = ChatMessage(
                message_id=msg_id,
                timestamp=current_msg["timestamp"],
                sender=sender,
                text=text_body,
                raw_text=text_body,
                is_system=is_system,
                is_deleted=is_deleted,
                attachment_filename=att_filename,
            )
            messages.append(msg)
            if not is_system and sender and sender != "System":
                participants.add(sender)
            current_msg = None

        for line in raw_lines:
            # Clean directional and invisible characters
            cleaned_line = line.replace("\u200e", "").replace("\u202f", " ").strip()
            if not cleaned_line:
                continue

            # Check iOS format: [DD/MM/YY, HH:MM:SS] Sender: Message
            m_ios = IOS_LINE_RE.match(cleaned_line)
            # Check Android format: DD/MM/YY, HH:MM - Sender: Message
            m_android = ANDROID_LINE_RE.match(cleaned_line)

            match = m_ios or m_android
            if match:
                _flush_current()
                date_part = match.group(1)
                time_part = match.group(2)
                rest = match.group(3).strip()

                try:
                    dt = parse_timestamp(date_part, time_part)
                except Exception as exc:
                    logger.debug("Failed parsing date %s %s: %s", date_part, time_part, exc)
                    dt = datetime.now(IST_ZONE)

                # Check if it has a sender or is a system message
                # Sender usually precedes a colon: "Sender: Message"
                if ": " in rest:
                    sender_part, msg_text = rest.split(": ", 1)
                    current_msg = {
                        "timestamp": dt,
                        "sender": sender_part.strip(),
                        "text": msg_text,
                        "is_system": False,
                    }
                else:
                    # System event
                    current_msg = {
                        "timestamp": dt,
                        "sender": "System",
                        "text": rest,
                        "is_system": True,
                    }
            else:
                # Continuation line of previous message
                if current_msg:
                    current_msg["text"] += "\n" + cleaned_line
                else:
                    # Preamble or header
                    pass

        _flush_current()

        return ParsedChatExport(
            group_name=group_name,
            messages=messages,
            participants=participants,
        )
