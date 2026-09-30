# Owner task: EB-37 Event extraction v1
"""Rule-based extraction of payment, approval, decision and change events from normalised chunks.

Why rules first: v1 has to be reproducible and auditable — the same chunk always yields the same events, every
number is copied verbatim from the source span (CLAUDE.md rule 3: numbers are never model output), and every
event carries the character span it came from (rule 4: evidence). An LLM pass can later add recall behind the
same ``ExtractedEvent`` contract through services/llm-gateway; it will not replace this precision layer.

Conservative by design: future/hypothetical ("will pay", "to be approved"), negated ("not approved",
"yet to release") and question sentences are not events. Event ids are content-derived, so re-ingesting a chunk
is idempotent.

Borrowed from: Rowboat event-from-note pattern (R2, R4) — sentence-level extraction with source back-references.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from enum import Enum
from typing import Any, Iterable

VERSION = 1


class EventType(str, Enum):
    PAYMENT = "payment"
    APPROVAL = "approval"
    DECISION = "decision"
    CHANGE = "change"


@dataclass(frozen=True)
class SourceChunk:
    tenant_id: str
    source_id: str
    source_ref: str
    text: str
    observed_at: datetime  # when the source says it was written/sent; fallback for undated sentences
    project_id: str | None = None
    content_hash: str | None = None


@dataclass(frozen=True)
class ExtractedEvent:
    tenant_id: str
    event_id: str
    event_type: EventType
    title: str
    occurred_at: datetime
    confidence: float
    source_id: str
    source_ref: str
    span: tuple[int, int]  # offsets into SourceChunk.text
    quote: str
    project_id: str | None = None
    amount: Decimal | None = None  # payments and changes only; parsed from the quote, never inferred
    currency: str | None = None
    reference: str | None = None  # UTR / cheque / RA bill / CO number
    content_hash: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def to_row(self) -> dict[str, Any]:
        """Shape of a row in the ``events`` table (db/migrations/0001_initial.sql)."""
        payload: dict[str, Any] = {"quote": self.quote, "span": list(self.span), "extractor_version": VERSION, **self.extra}
        if self.amount is not None:
            payload.update(amount=str(self.amount), currency=self.currency)  # string: never a float
        if self.reference:
            payload["reference"] = self.reference
        return {
            "tenant_id": self.tenant_id, "event_id": self.event_id, "event_type": self.event_type.value,
            "project_id": self.project_id, "occurred_at": self.occurred_at.isoformat(), "title": self.title,
            "description": self.quote, "confidence": round(self.confidence, 4), "source_id": self.source_id,
            "source_ref": self.source_ref, "content_hash": self.content_hash, "payload": payload,
        }


# --- amounts: 12,50,000 / 1.5 crore / 3 lakh / Rs. 45000 / INR 2.4 cr ------------------------------------------
_AMOUNT = re.compile(
    r"(?P<cur>₹|rs\.?|inr)\s*(?P<num>\d[\d,]*(?:\.\d+)?)\s*(?P<unit>crores?|cr\b|lakhs?|lacs?|l\b|k\b)?"
    r"|(?P<num2>\d[\d,]*(?:\.\d+)?)\s*(?P<unit2>crores?|cr\b|lakhs?|lacs?)\s*(?:rupees|inr|rs)?",
    re.IGNORECASE,
)
_UNIT = {"crore": Decimal(10_000_000), "crores": Decimal(10_000_000), "cr": Decimal(10_000_000),
         "lakh": Decimal(100_000), "lakhs": Decimal(100_000), "lac": Decimal(100_000), "lacs": Decimal(100_000),
         "l": Decimal(100_000), "k": Decimal(1000)}


def parse_amount(text: str) -> tuple[Decimal, str, tuple[int, int]] | None:
    """First rupee amount in ``text`` as (Decimal rupees, 'INR', span), or None. Exact decimal arithmetic."""
    m = _AMOUNT.search(text)
    if not m:
        return None
    num = m.group("num") or m.group("num2")
    unit = (m.group("unit") or m.group("unit2") or "").lower()
    value = Decimal(num.replace(",", "")) * _UNIT.get(unit, Decimal(1))
    return value.normalize() if value != value.to_integral() else value.quantize(Decimal(1)), "INR", m.span()


# --- dates -----------------------------------------------------------------------------------------------------
_MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
_DATE_NUM = re.compile(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b")
_DATE_TXT = re.compile(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})\b", re.I)


def parse_date(text: str) -> datetime | None:
    try:
        m = _DATE_NUM.search(text)
        if m:  # Indian convention: day first
            return datetime(int(m.group(3)), int(m.group(2)), int(m.group(1)), tzinfo=timezone.utc)
        m = _DATE_TXT.search(text)
        if m:
            return datetime(int(m.group(3)), _MONTHS[m.group(2).lower()[:3]], int(m.group(1)), tzinfo=timezone.utc)
    except ValueError:
        return None
    return None


# --- sentence rules --------------------------------------------------------------------------------------------
_PAYMENT = re.compile(r"\b(paid|released|transferred|credited|remitted|settled|received (?:a )?payment|payment (?:of|made|received|released))\b", re.I)
_APPROVAL = re.compile(r"\b(approved|sanctioned|signed off|cleared|authori[sz]ed|accepted)\b", re.I)
_DECISION = re.compile(r"\b(decided|agreed|finali[sz]ed|resolved|we will go with|going ahead with|confirmed that|conclusion:)\b", re.I)
_CHANGE = re.compile(r"\b(change order|variation order|scope change|revised (?:drawing|boq|scope|estimate)|rev(?:ision)?\s?\d+|additional work)\b", re.I)
_FUTURE = re.compile(r"\b(will|shall|to be|yet to|pending|awaiting|once|if|should|needs? to|going to|plan(?:s|ned)? to|expected)\b", re.I)
_NEGATED = re.compile(r"\b(not|no|never|didn't|hasn't|haven't|wasn't|isn't|unable to|declined|rejected|refused)\b", re.I)
_REF_DOC = re.compile(r"\b((?:co|vo)[-\s#]?\d[A-Z0-9/-]*)\b", re.I)  # CO-117 / VO 88 keep their prefix
_REF = re.compile(r"\b(?:utr|ref(?:erence)?|cheque|chq|ra bill)\b\s*(?:no\.?|#|:|-)?\s*([A-Z]*\d[A-Z0-9/-]{2,})", re.I)


def _reference(sentence: str) -> str | None:
    m = _REF_DOC.search(sentence) or _REF.search(sentence)
    return m.group(1).upper().replace(" ", "-") if m else None


_BOUNDARY = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9₹\"'(])|\n+")
_ABBREV = re.compile(r"(?:\brs|\bno|\bnos|\bdr|\bmr|\bmrs|\bms|\bsh|\bsmt|\bm/s|\bapprox|\bvs|\be\.g|\bi\.e)\.$", re.I)


def _sentences(text: str) -> Iterable[tuple[int, int, str]]:
    """Split on sentence boundaries without breaking on 'Rs.', 'No.', 'Dr.' or decimals."""
    start = 0
    for m in _BOUNDARY.finditer(text):
        piece = text[start:m.start()]
        if _ABBREV.search(piece):
            continue  # abbreviation, keep accumulating
        if piece.strip():
            yield start, m.start(), piece
        start = m.end()
    tail = text[start:]
    if tail.strip():
        yield start, len(text), tail


def _event_id(chunk: SourceChunk, etype: EventType, span: tuple[int, int]) -> str:
    h = hashlib.sha256(f"{chunk.tenant_id}|{chunk.source_ref}|{etype.value}|{span[0]}:{span[1]}".encode()).hexdigest()
    return f"ev-{h[:16]}"


def extract_events(chunk: SourceChunk, min_confidence: float = 0.5) -> list[ExtractedEvent]:
    out: list[ExtractedEvent] = []
    for start, end, sentence in _sentences(chunk.text):
        if sentence.strip().endswith("?") or _FUTURE.search(sentence) or _NEGATED.search(sentence):
            continue
        for etype, rule in ((EventType.PAYMENT, _PAYMENT), (EventType.APPROVAL, _APPROVAL),
                            (EventType.DECISION, _DECISION), (EventType.CHANGE, _CHANGE)):
            if not rule.search(sentence):
                continue
            amount = parse_amount(sentence) if etype in (EventType.PAYMENT, EventType.CHANGE) else None
            if etype is EventType.PAYMENT and amount is None:
                continue  # a payment with no amount is noise, not an event
            ref = _reference(sentence)
            dated = parse_date(sentence)
            confidence = 0.55 + (0.2 if amount else 0) + (0.1 if dated else 0) + (0.1 if ref else 0)
            if confidence < min_confidence:
                continue
            quote = sentence.strip()
            span = (start + sentence.index(quote), start + sentence.index(quote) + len(quote))
            out.append(ExtractedEvent(
                tenant_id=chunk.tenant_id, event_id=_event_id(chunk, etype, span), event_type=etype,
                title=(quote[:117] + "...") if len(quote) > 120 else quote,
                occurred_at=dated or chunk.observed_at, confidence=min(confidence, 0.95), source_id=chunk.source_id,
                source_ref=chunk.source_ref, span=span, quote=quote, project_id=chunk.project_id,
                amount=amount[0] if amount else None, currency=amount[1] if amount else None,
                reference=ref, content_hash=chunk.content_hash,
                extra={"date_from_text": dated is not None},
            ))
    return out
