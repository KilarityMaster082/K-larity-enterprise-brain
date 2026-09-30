# Owner task: EB-30 Document parsing (Docling / Tika) and contextual chunking
"""Message window chunker for chat transcripts (WhatsApp, Slack, and site coordination channels)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import re
from typing import Any

from services.normalization.models import DocumentChunk, ParsedDocument
from services.normalization.provenance.spans import ProvenanceSpan


@dataclass
class ChatMessage:
    """Individual parsed message from a chat export or webhook stream."""

    sender: str
    timestamp_str: str
    text: str
    message_id: str | None = None
    timestamp: datetime | None = None


class MessageWindowChunker:
    """Chunks chat records into contextual session windows.

    Splits when:
    - Inactivity between consecutive messages exceeds idle_timeout_minutes (default 30 min).
    - Message count reaches max_messages_per_chunk (default 25).
    - Estimated token count exceeds max_tokens_per_chunk (default 500).
    """

    def __init__(
        self,
        *,
        idle_timeout_minutes: int = 30,
        max_messages_per_chunk: int = 25,
        max_tokens_per_chunk: int = 500,
    ) -> None:
        self.idle_timeout_minutes = idle_timeout_minutes
        self.max_messages = max_messages_per_chunk
        self.max_tokens = max_tokens_per_chunk

    def parse_transcript_lines(self, text: str) -> list[ChatMessage]:
        """Parses common WhatsApp/Slack export lines: '[DD/MM/YY, HH:MM:SS] Sender: Message'."""
        messages: list[ChatMessage] = []
        # Pattern 1: [12/05/26, 14:30:15] Sanjay: Concrete arrived on site
        # Pattern 2: 12/05/2026, 14:30 - Sanjay: Concrete arrived on site
        pattern = re.compile(
            r"^\[?(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}[,\s]+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[APap][Mm])?)\]?(?:\s*-\s*)?\s*([^:]+):\s*(.+)$"
        )

        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            m = pattern.match(line)
            if m:
                ts_str, sender, msg_text = m.group(1), m.group(2).strip(), m.group(3).strip()
                dt = self._parse_date(ts_str)
                messages.append(
                    ChatMessage(
                        sender=sender,
                        timestamp_str=ts_str,
                        text=msg_text,
                        timestamp=dt,
                    )
                )
            else:
                # Multi-line message continuation
                if messages:
                    messages[-1].text += f"\n{line}"
                else:
                    messages.append(
                        ChatMessage(
                            sender="System",
                            timestamp_str="",
                            text=line,
                        )
                    )

        return messages

    def _parse_date(self, s: str) -> datetime | None:
        for fmt in (
            "%d/%m/%y, %H:%M:%S",
            "%d/%m/%Y, %H:%M:%S",
            "%d/%m/%y, %H:%M",
            "%d/%m/%Y, %H:%M",
            "%Y-%m-%d %H:%M:%S",
            "%d-%m-%Y %H:%M:%S",
        ):
            try:
                return datetime.strptime(s.strip("[]"), fmt)
            except ValueError:
                continue
        return None

    def chunk_chat(
        self,
        doc: ParsedDocument,
        *,
        project_name: str | None = None,
        channel_name: str | None = "Site Coordination",
    ) -> list[DocumentChunk]:
        """Partitions the chat text into windowed session chunks with participant context."""
        messages = self.parse_transcript_lines(doc.text)
        if not messages:
            # Fallback to single chunk
            return []

        chunks: list[DocumentChunk] = []
        current_batch: list[ChatMessage] = []
        chunk_idx = 0

        for msg in messages:
            split_needed = False
            if current_batch:
                # Check message count
                if len(current_batch) >= self.max_messages:
                    split_needed = True

                # Check idle time
                last_msg = current_batch[-1]
                if msg.timestamp and last_msg.timestamp:
                    diff_mins = (msg.timestamp - last_msg.timestamp).total_seconds() / 60.0
                    if diff_mins > self.idle_timeout_minutes:
                        split_needed = True

                # Check token threshold
                est_tokens = sum(len(m.text) // 4 for m in current_batch)
                if est_tokens >= self.max_tokens:
                    split_needed = True

            if split_needed and current_batch:
                chunks.append(
                    self._create_chunk(
                        batch=current_batch,
                        doc=doc,
                        chunk_idx=chunk_idx,
                        project_name=project_name,
                        channel_name=channel_name,
                    )
                )
                chunk_idx += 1
                current_batch = [msg]
            else:
                current_batch.append(msg)

        if current_batch:
            chunks.append(
                self._create_chunk(
                    batch=current_batch,
                    doc=doc,
                    chunk_idx=chunk_idx,
                    project_name=project_name,
                    channel_name=channel_name,
                )
            )

        return chunks

    def _create_chunk(
        self,
        batch: list[ChatMessage],
        doc: ParsedDocument,
        chunk_idx: int,
        project_name: str | None,
        channel_name: str | None,
    ) -> DocumentChunk:
        participants = sorted({m.sender for m in batch if m.sender != "System"})
        p_str = ", ".join(participants) if participants else "Unknown"
        first_ts = batch[0].timestamp_str or "Unknown Date"
        last_ts = batch[-1].timestamp_str or ""

        # Build contextual header
        header_parts: list[str] = []
        if project_name:
            header_parts.append(f"[Project: {project_name}]")
        if channel_name:
            header_parts.append(f"[Channel: {channel_name}]")
        header_parts.append(f"[Session: {first_ts}{' to ' + last_ts if last_ts else ''}]")
        header_parts.append(f"[Participants: {p_str}]")
        context_hdr = " ".join(header_parts)

        # Assemble transcript text
        raw_lines = [f"{m.timestamp_str} {m.sender}: {m.text}".strip() for m in batch]
        raw_content = "\n".join(raw_lines)
        full_text = f"{context_hdr}\n\n{raw_content}"

        prov = ProvenanceSpan(
            source_id=doc.document_id,
            source_ref=doc.filename,
            content_hash=doc.content_hash,
            page_no=1,
            temporal_valid_from=first_ts,
            temporal_valid_to=last_ts,
            extra_metadata={
                "message_count": len(batch),
                "participants": participants,
            },
        )

        return DocumentChunk(
            chunk_id=f"{doc.document_id}-chat-{chunk_idx}",
            document_id=doc.document_id,
            tenant_id=doc.tenant_id,
            chunk_index=chunk_idx,
            text=full_text,
            raw_content=raw_content,
            token_count=max(1, len(full_text) // 4),
            chunk_type="chat_window",
            provenance=prov,
            context_header=context_hdr,
        )
