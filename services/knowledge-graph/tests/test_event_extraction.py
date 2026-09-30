# Owner task: EB-37 Event extraction v1
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

import pytest

from extractors.events import EventType, SourceChunk, extract_events, parse_amount, parse_date

NOW = datetime(2026, 10, 1, tzinfo=timezone.utc)


def chunk(text: str, **kw) -> SourceChunk:
    return SourceChunk("studio8", "src-1", "gmail:msg-42", text, NOW, project_id=kw.get("project_id", "phoenix"))


@pytest.mark.parametrize("text,expected", [
    ("Paid Rs. 12,50,000 to the vendor", Decimal("1250000")),
    ("released ₹1.5 crore yesterday", Decimal("15000000")),
    ("advance of INR 3 lakh", Decimal("300000")),
    ("balance 2.5 cr pending", Decimal("25000000")),
    ("₹45000 paid", Decimal("45000")),
])
def test_indian_amount_formats_parse_exactly(text, expected) -> None:
    got = parse_amount(text)
    assert got is not None and got[0] == expected and got[1] == "INR"


def test_no_amount_no_parse() -> None:
    assert parse_amount("the slab was poured on 3 floors") is None


def test_dates_are_day_first() -> None:
    assert parse_date("on 04/10/2026") == datetime(2026, 10, 4, tzinfo=timezone.utc)
    assert parse_date("on 4th Oct 2026") == datetime(2026, 10, 4, tzinfo=timezone.utc)
    assert parse_date("on 31/02/2026") is None


def test_payment_event_carries_amount_reference_span_and_source() -> None:
    text = "Hi team. We released Rs. 12,50,000 to Sharma Constructions on 04/10/2026, UTR SBIN2610041234. Thanks."
    (ev,) = extract_events(chunk(text))
    assert ev.event_type is EventType.PAYMENT and ev.amount == Decimal("1250000") and ev.currency == "INR"
    assert ev.reference == "SBIN2610041234" and ev.occurred_at == datetime(2026, 10, 4, tzinfo=timezone.utc)
    assert text[ev.span[0]:ev.span[1]] == ev.quote and "12,50,000" in ev.quote  # number copied from the source
    row = ev.to_row()
    assert row["tenant_id"] == "studio8" and row["source_ref"] == "gmail:msg-42" and row["payload"]["amount"] == "1250000"
    assert isinstance(row["payload"]["amount"], str)  # never a float


def test_approval_decision_and_change_events() -> None:
    text = ("CFO approved the revised BOQ for Tower B. "
            "We decided to go with the 40mm aggregate mix. "
            "Change order CO-117 raised for additional work worth Rs. 4,20,000.")
    events = extract_events(chunk(text))
    assert {e.event_type for e in events} == {EventType.APPROVAL, EventType.DECISION, EventType.CHANGE}
    change = next(e for e in events if e.event_type is EventType.CHANGE and e.reference)
    assert change.amount == Decimal("420000") and change.reference == "CO-117"


@pytest.mark.parametrize("text", [
    "We will pay Rs. 5,00,000 next week.",
    "Payment of Rs. 5,00,000 is yet to be released.",
    "The drawing was not approved by the client.",
    "Has the vendor been paid Rs. 5,00,000?",
    "If the CFO approves, we will release funds.",
    "Paid the vendor",  # payment without an amount
    "Good morning, site visit at 4pm.",
])
def test_future_negated_question_and_noise_are_not_events(text) -> None:
    assert extract_events(chunk(text)) == []


def test_extraction_is_deterministic_and_idempotent() -> None:
    text = "Released Rs. 2,00,000 to Zenith Steel on 02/10/2026."
    a, b = extract_events(chunk(text)), extract_events(chunk(text))
    assert [e.event_id for e in a] == [e.event_id for e in b] and len(a) == 1
    other = extract_events(SourceChunk("studio8", "src-1", "gmail:msg-99", text, NOW))
    assert other[0].event_id != a[0].event_id  # distinct source → distinct event


def test_tenant_id_flows_through_and_undated_uses_observation_time() -> None:
    events = extract_events(SourceChunk("other", "s", "r", "Approved the variation order VO-88.", NOW))
    # one sentence can be both an approval and a change; both are kept and both carry the tenant
    assert {e.event_type for e in events} == {EventType.APPROVAL, EventType.CHANGE}
    assert all(e.tenant_id == "other" and e.occurred_at == NOW and e.to_row()["tenant_id"] == "other" for e in events)
