# Owner task: EB-32 WhatsApp chat-export parser
"""Unit and integration tests for WhatsApp export connector and parser."""

from __future__ import annotations

import io
import zipfile
import pytest

from connectors_sdk.errors import ConnectorConfigError
from connectors_sdk.models import Cursor, RecordType, SourceContext
from services.ingestion.connectors.whatsapp_export.connector import WhatsAppExportConnector
from services.ingestion.connectors.whatsapp_export.parser import WhatsAppExportParser


@pytest.fixture
def source_ctx() -> SourceContext:
    return SourceContext(
        tenant_id="tenant-studio8",
        source_id="wa-exports",
        connector_type="whatsapp_export",
        config={
            "group_to_project": {
                "Studio 8 Site Coordination": "proj-villa-s8",
                "Prestige Tower MEP": "proj-prestige-mep",
                "Embassy TechVillage Interiors": "proj-embassy-int",
            },
            "default_project_id": "proj-general",
        },
    )


def test_android_and_ios_format_parsing() -> None:
    parser = WhatsAppExportParser()

    # 1. Android format (24h and 12h, multi-line)
    android_text = (
        "25/09/2026, 14:30 - Messages and calls are end-to-end encrypted. No one outside of this chat can read them.\n"
        "25/09/2026, 14:32 - Sanjay Kilari: Site inspection is scheduled for tomorrow at 10 AM.\n"
        "Please bring updated drawing sets.\n"
        "25/09/2026, 2:35 pm - Ramesh Site Eng: Noted sir.\n"
        "I will coordinate with the contractor.\n"
        "25/09/2026, 14:40 - Alice: This message was deleted\n"
    )

    parsed_android = parser.parse_text(android_text, group_name="Studio 8 Site Coordination")
    assert parsed_android.group_name == "Studio 8 Site Coordination"
    assert len(parsed_android.messages) == 4

    # System message
    m0 = parsed_android.messages[0]
    assert m0.is_system
    assert "end-to-end encrypted" in m0.text

    # Multi-line message from Sanjay
    m1 = parsed_android.messages[1]
    assert not m1.is_system
    assert m1.sender == "Sanjay Kilari"
    assert "Site inspection is scheduled" in m1.text
    assert "Please bring updated drawing sets." in m1.text

    # 12h format message from Ramesh
    m2 = parsed_android.messages[2]
    assert m2.sender == "Ramesh Site Eng"
    assert m2.timestamp.hour == 14
    assert m2.timestamp.minute == 35

    # Deleted message
    m3 = parsed_android.messages[3]
    assert m3.is_deleted

    # Participants
    assert "Sanjay Kilari" in parsed_android.participants
    assert "Ramesh Site Eng" in parsed_android.participants

    # 2. iOS format (with brackets and seconds)
    ios_text = (
        "[26/09/26, 09:15:20] Messages and calls are end-to-end encrypted.\n"
        "[26/09/26, 09:16:05] Priya Architect: Sent the revised floor plan for Embassy TechVillage.\n"
        "[26/09/26, 09:17:10] \u200eSanjay Kilari: Looks great, reviewing now.\n"
    )

    parsed_ios = parser.parse_text(ios_text, group_name="Embassy TechVillage Interiors")
    assert len(parsed_ios.messages) == 3
    assert parsed_ios.messages[1].sender == "Priya Architect"
    assert "Priya Architect" in parsed_ios.participants
    assert "Sanjay Kilari" in parsed_ios.participants


def test_zip_archive_with_media_handover() -> None:
    parser = WhatsAppExportParser()

    # Create an in-memory zip archive with _chat.txt and a PDF BOQ
    pdf_bytes = b"%PDF-1.4\n1 0 obj\n<< /Title (Studio 8 BOQ) >>\nendobj\ntrailer\n<< >>\n%%EOF"
    chat_content = (
        "[27/09/2026, 11:00:00] Contractor Dave: <attached: HVAC_BOQ_Final.pdf>\n"
        "[27/09/2026, 11:01:00] Sanjay Kilari: Received the BOQ, thanks Dave.\n"
    )

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w") as zf:
        zf.writestr("_chat.txt", chat_content.encode("utf-8"))
        zf.writestr("HVAC_BOQ_Final.pdf", pdf_bytes)

    zip_bytes = zip_buffer.getvalue()
    parsed = parser.parse_zip(zip_bytes, group_name_fallback="Prestige Tower MEP")

    assert len(parsed.messages) == 2
    assert "HVAC_BOQ_Final.pdf" in parsed.attachments
    assert parsed.messages[0].attachment_filename == "HVAC_BOQ_Final.pdf"
    assert parsed.messages[0].media is not None
    assert parsed.messages[0].media.mime_type == "application/pdf"
    assert parsed.messages[0].media.size == len(pdf_bytes)


def test_whatsapp_connector_3_pilot_groups_and_project_mapping(source_ctx: SourceContext) -> None:
    connector = WhatsAppExportConnector()
    connector.authenticate(source_ctx, {})
    connector.validate_config(source_ctx)

    bad_ctx = SourceContext(
        tenant_id="tenant-studio8",
        source_id="wa-bad",
        connector_type="whatsapp_export",
        config={"group_to_project": "not-a-dict"},
    )
    with pytest.raises(ConnectorConfigError):
        connector.validate_config(bad_ctx)

    # 3 Pilot project groups
    # Group 1: Studio 8 Site Coordination -> proj-villa-s8
    txt1 = (
        "28/09/2026, 10:00 - Sanjay: Formwork inspection done.\n"
        "28/09/2026, 10:05 - Ramesh: Ready for slab casting.\n"
    )
    # Group 2: Prestige Tower MEP -> proj-prestige-mep
    txt2 = (
        "28/09/2026, 11:00 - Dave: Chiller installation delayed by 2 days.\n"
        "28/09/2026, 11:10 - Sanjay: Please mitigate with overtime.\n"
    )
    # Group 3: Embassy TechVillage Interiors -> proj-embassy-int
    txt3 = (
        "[28/09/2026, 12:00:00] Priya Architect: False ceiling gypsum samples approved.\n"
        "[28/09/2026, 12:05:00] Sanjay: Perfect, proceed with procurement.\n"
    )

    connector.set_simulated_upload(source_ctx, "WhatsApp Chat with Studio 8 Site Coordination.txt", txt1.encode("utf-8"))
    connector.set_simulated_upload(source_ctx, "WhatsApp Chat with Prestige Tower MEP.txt", txt2.encode("utf-8"))
    connector.set_simulated_upload(source_ctx, "WhatsApp Chat with Embassy TechVillage Interiors.txt", txt3.encode("utf-8"))

    # Fetch
    gen = connector.fetch_since(source_ctx, Cursor())
    items = []
    try:
        while True:
            items.append(next(gen))
    except StopIteration as stop:
        c1 = stop.value

    assert len(items) == 3

    # Check Pilot Group 1
    item1 = items[0]
    acl1 = connector.fetch_acl(source_ctx, item1)
    recs1 = connector.normalize(source_ctx, item1, acl1, raw_ref="raw/wa/1")
    assert len(recs1) == 1
    assert recs1[0].record_type == RecordType.MESSAGE
    assert recs1[0].metadata["project_id"] == "proj-villa-s8"
    assert recs1[0].metadata["group_name"] == "Studio 8 Site Coordination"
    assert "participant:Sanjay" in acl1.users
    assert "participant:Ramesh" in acl1.users

    # Check Pilot Group 2
    item2 = items[1]
    acl2 = connector.fetch_acl(source_ctx, item2)
    recs2 = connector.normalize(source_ctx, item2, acl2, raw_ref="raw/wa/2")
    assert recs2[0].metadata["project_id"] == "proj-prestige-mep"

    # Check Pilot Group 3
    item3 = items[2]
    acl3 = connector.fetch_acl(source_ctx, item3)
    recs3 = connector.normalize(source_ctx, item3, acl3, raw_ref="raw/wa/3")
    assert recs3[0].metadata["project_id"] == "proj-embassy-int"


def test_reupload_dedupes_by_content_hash(source_ctx: SourceContext) -> None:
    connector = WhatsAppExportConnector()
    connector.authenticate(source_ctx, {})

    content = "29/09/2026, 09:00 - Sanjay: Morning briefing on site.\n"
    connector.set_simulated_upload(source_ctx, "WhatsApp Chat with Studio 8 Site Coordination.txt", content.encode("utf-8"))

    # First fetch
    gen1 = connector.fetch_since(source_ctx, Cursor())
    items1 = []
    try:
        while True:
            items1.append(next(gen1))
    except StopIteration as stop:
        c1 = stop.value

    assert len(items1) == 1
    assert len(c1.value["synced_hashes"]) == 1

    # Second fetch with the same cursor (re-upload attempt)
    gen2 = connector.fetch_since(source_ctx, c1)
    items2 = []
    try:
        while True:
            items2.append(next(gen2))
    except StopIteration as stop:
        c2 = stop.value

    # Re-uploaded export is deduped and yields 0 items
    assert len(items2) == 0
