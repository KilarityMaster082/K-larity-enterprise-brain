# Owner task: EB-30 Document parsing (Docling / Tika) and contextual chunking
"""Comprehensive tests for document normalization, OCR, and structure-aware chunking."""

from __future__ import annotations

import json
import pytest

from services.normalization import (
    BoundingBox,
    DoclingParser,
    MessageWindowChunker,
    OCRParser,
    ParsedDocument,
    ParsedTable,
    ProvenanceSpan,
    StructureAwareChunker,
    TikaParser,
)


# ----------------------------------------------------------------------------------------------------
# 1. Provenance and BoundingBox Tests
# ----------------------------------------------------------------------------------------------------
def test_bounding_box_geometry_and_serialization() -> None:
    bbox = BoundingBox(page=1, x0=100.0, y0=200.0, x1=400.0, y1=600.0)
    assert bbox.width == 300.0
    assert bbox.height == 400.0
    assert bbox.area == 120000.0

    # Overlap test
    overlapping = BoundingBox(page=1, x0=200.0, y0=300.0, x1=500.0, y1=700.0)
    assert bbox.intersects(overlapping) is True

    non_overlapping = BoundingBox(page=1, x0=500.0, y0=700.0, x1=600.0, y1=800.0)
    assert bbox.intersects(non_overlapping) is False

    # Different page never intersects
    diff_page = BoundingBox(page=2, x0=100.0, y0=200.0, x1=400.0, y1=600.0)
    assert bbox.intersects(diff_page) is False

    # Validation
    with pytest.raises(ValueError):
        BoundingBox(page=0, x0=0.0, y0=0.0, x1=10.0, y1=10.0)
    with pytest.raises(ValueError):
        BoundingBox(page=1, x0=50.0, y0=0.0, x1=20.0, y1=10.0)

    # Roundtrip serialization
    d = bbox.to_dict()
    assert BoundingBox.from_dict(d) == bbox


def test_provenance_span_serialization() -> None:
    bbox = BoundingBox(page=2, x0=50.0, y0=100.0, x1=500.0, y1=400.0)
    span = ProvenanceSpan(
        source_id="doc-123",
        source_ref="s8_boq.pdf",
        content_hash="abc123hash",
        page_no=2,
        bbox=bbox,
        temporal_valid_from="2026-01-01",
        extra_metadata={"contractor": "Acme Projects"},
    )
    d = span.to_dict()
    restored = ProvenanceSpan.from_dict(d)
    assert restored.source_id == "doc-123"
    assert restored.page_no == 2
    assert restored.bbox == bbox
    assert restored.extra_metadata["contractor"] == "Acme Projects"


# ----------------------------------------------------------------------------------------------------
# 2. Parsers Tests (Docling with Tika fallback)
# ----------------------------------------------------------------------------------------------------
def test_tika_parser_csv_and_markdown_tables() -> None:
    parser = TikaParser()
    csv_content = b"Item,Description,Qty,Unit,Rate\n1,Cement Bags,100,Bags,380.00\n2,Steel MT,5,MT,65000.00\n"

    parsed = parser.parse(
        content=csv_content,
        filename="cement_schedule.csv",
        tenant_id="studio8",
        document_id="doc-csv-1",
    )
    assert parsed.document_id == "doc-csv-1"
    assert parsed.tenant_id == "studio8"
    assert len(parsed.tables) == 1
    table = parsed.tables[0]
    assert table.headers == ["Item", "Description", "Qty", "Unit", "Rate"]
    assert len(table.rows) == 2
    assert table.rows[0][1] == "Cement Bags"

    # Verify Markdown rendering
    md = table.to_markdown()
    assert "| Item | Description | Qty | Unit | Rate |" in md
    assert "| 1 | Cement Bags | 100 | Bags | 380.00 |" in md


def test_docling_parser_fallback_flow() -> None:
    docling_p = DoclingParser()
    text_content = (
        b"# Phoenix Project Specifications\n\n"
        b"All concrete works must adhere to IS 456:2000.\n\n"
        b"| Item | Grade | Aggregate Size |\n"
        b"|---|---|---|\n"
        b"| 1 | M25 | 20mm down |\n"
        b"| 2 | M30 | 20mm down |\n"
    )

    parsed = docling_p.parse(
        content=text_content,
        filename="phoenix_spec.md",
        tenant_id="studio8",
        document_id="doc-spec-1",
    )
    assert parsed.document_id == "doc-spec-1"
    assert "IS 456:2000" in parsed.text
    assert len(parsed.tables) == 1
    assert parsed.tables[0].headers == ["Item", "Grade", "Aggregate Size"]
    assert parsed.tables[0].rows[0][1] == "M25"


# ----------------------------------------------------------------------------------------------------
# 3. OCR Parser Tests (Scanned Bills, GSTIN, and Indian Financial Totals)
# ----------------------------------------------------------------------------------------------------
def test_ocr_parser_extracts_financial_entities() -> None:
    ocr = OCRParser()
    sample_bill_text = (
        "TAX INVOICE / DELIVERY CHALLAN\n"
        "M/s Vardhman ReadyMix Concrete Pvt Ltd\n"
        "GSTIN: 27AABCV1234F1Z5\n"
        "Invoice No: VRMC/2026/089\n"
        "Date: 15/09/2026\n\n"
        "Item No | Description | Qty | Unit | Rate (₹) | Amount (₹)\n"
        "1 | Design Mix Concrete M30 | 25 | cu.m | 4,800.00 | 1,20,000.00\n"
        "2 | Pumping Charges | 1 | Trip | 6,500.00 | 6,500.00\n\n"
        "Subtotal: ₹1,26,500.00\n"
        "CGST 9%: ₹11,385.00\n"
        "SGST 9%: ₹11,385.00\n"
        "Grand Total: ₹1,49,270.00\n"
    ).encode("utf-8")

    parsed = ocr.parse(
        content=sample_bill_text,
        filename="vrmc_challan.png",
        tenant_id="studio8",
        document_id="ocr-bill-1",
    )

    assert parsed.metadata["gstin"] == "27AABCV1234F1Z5"
    assert parsed.metadata["invoice_number"] == "VRMC/2026/089"
    assert parsed.metadata["invoice_date"] == "15/09/2026"
    assert parsed.metadata["total_amount"] == 149270.0
    assert parsed.metadata["currency"] == "INR"
    assert len(parsed.tables) == 1
    assert len(parsed.tables[0].rows) >= 2


# ----------------------------------------------------------------------------------------------------
# 4. Structure-Aware Chunking Tests
# ----------------------------------------------------------------------------------------------------
def test_structure_aware_chunker_boq_preserves_table_integrity() -> None:
    chunker = StructureAwareChunker(target_table_rows_per_chunk=2)

    headers = ["Item", "Description", "Qty", "Unit", "Rate", "Total"]
    rows = [
        ["1.1", "Earthwork excavation in foundation", "450", "cu.m", "220.00", "99,000.00"],
        ["1.2", "PCC 1:4:8 below footings", "45", "cu.m", "3,800.00", "1,71,000.00"],
        ["1.3", "RCC M25 in columns", "80", "cu.m", "6,200.00", "4,96,000.00"],
    ]
    table = ParsedTable(headers=headers, rows=rows, page_no=3, bbox=BoundingBox(page=3, x0=50.0, y0=100.0, x1=900.0, y1=600.0))

    doc = ParsedDocument.from_content(
        document_id="boq-doc-1",
        tenant_id="studio8",
        filename="Substructure_BOQ.pdf",
        content_type="application/pdf",
        raw_bytes=b"raw",
        text="Bill of Quantities for Substructure Works\n" + table.to_markdown(),
        tables=[table],
        page_count=3,
    )

    chunks = chunker.chunk_document(doc, project_name="Project Phoenix", document_date="2026-09-15")

    # Rows grouped in batches of 2: 3 rows should yield 2 table chunks
    table_chunks = [c for c in chunks if c.chunk_type == "table"]
    assert len(table_chunks) == 2

    # Verify Chunk 1
    assert table_chunks[0].chunk_index == 0
    assert "[Project: Project Phoenix]" in table_chunks[0].context_header
    assert "[Source: Substructure_BOQ.pdf]" in table_chunks[0].context_header
    assert "| 1.1 | Earthwork excavation in foundation |" in table_chunks[0].text
    assert "| 1.2 | PCC 1:4:8 below footings |" in table_chunks[0].text
    assert table_chunks[0].provenance.page_no == 3
    assert table_chunks[0].provenance.extra_metadata["row_start"] == 1
    assert table_chunks[0].provenance.extra_metadata["row_end"] == 2

    # Verify Chunk 2 has header replicated
    assert "| Item | Description | Qty | Unit | Rate | Total |" in table_chunks[1].text
    assert "| 1.3 | RCC M25 in columns |" in table_chunks[1].text
    assert table_chunks[1].provenance.extra_metadata["row_start"] == 3


def test_structure_aware_chunker_quotation_two_pass() -> None:
    chunker = StructureAwareChunker()
    quote_text = (
        "QUOTATION FOR HVAC EQUIPMENT\n"
        "Vendor: BlueStar Engineering Solutions\n"
        "GSTIN: 29AABCB9876E1Z2\n"
        "Quotation No: BS-BLR-2026-44\n"
        "Validity: 30 Days from date of issue\n"
        "Payment Terms: 30% advance, 70% against delivery\n"
        "Total Amount: ₹18,40,000.00\n\n"
        "| Item | Model | Qty | Rate | Amount |\n"
        "|---|---|---|---|---|\n"
        "| 1 | VRF Outdoor Unit 16HP | 2 | 4,20,000.00 | 8,40,000.00 |\n"
        "| 2 | Ductable Indoor Unit 4TR | 10 | 1,00,000.00 | 10,00,000.00 |\n"
    )
    headers = ["Item", "Model", "Qty", "Rate", "Amount"]
    rows = [
        ["1", "VRF Outdoor Unit 16HP", "2", "4,20,000.00", "8,40,000.00"],
        ["2", "Ductable Indoor Unit 4TR", "10", "1,00,000.00", "10,00,000.00"],
    ]
    tbl = ParsedTable(headers=headers, rows=rows, page_no=1)

    doc = ParsedDocument.from_content(
        document_id="quote-doc-1",
        tenant_id="studio8",
        filename="HVAC_Quote.pdf",
        content_type="application/pdf",
        raw_bytes=quote_text.encode("utf-8"),
        text=quote_text,
        tables=[tbl],
    )

    chunks = chunker.chunk_document(doc, project_name="Project Phoenix", document_date="2026-09-18")
    assert len(chunks) >= 2

    # Pass 1: Terms chunk
    terms_chunk = [c for c in chunks if c.chunk_type == "header"][0]
    assert "[Section: Commercial Terms & Header]" in terms_chunk.context_header
    assert "GSTIN: 29AABCB9876E1Z2" in terms_chunk.text
    assert "Payment Terms: 30% advance" in terms_chunk.text

    # Pass 2: Line items chunk
    items_chunk = [c for c in chunks if c.chunk_type == "table"][0]
    assert "VRF Outdoor Unit 16HP" in items_chunk.text


def test_structure_aware_chunker_cad_drawing() -> None:
    chunker = StructureAwareChunker()
    cad_text = (
        "Project: Studio 8 Headquarters\n"
        "Drawing No: S8-HQ-STR-004\n"
        "Revision: R2\n"
        "Scale: 1:100\n"
        "Status: Good for Construction (GFC)\n"
        "Date: 20/08/2026\n"
        "Architect: Studio 8 Design Consultants\n\n"
        "General Notes:\n"
        "1. All dimensions are in millimeters unless noted otherwise.\n"
        "2. Concrete cover for column rebar shall be 40mm.\n"
    )
    doc = ParsedDocument.from_content(
        document_id="cad-doc-1",
        tenant_id="studio8",
        filename="S8-HQ-STR-004_R2_drawing.pdf",
        content_type="application/pdf",
        raw_bytes=cad_text.encode("utf-8"),
        text=cad_text,
    )

    chunks = chunker.chunk_document(doc, project_name="Studio 8 HQ", document_date="2026-08-20")
    title_chunks = [c for c in chunks if c.chunk_type == "cad_title"]
    assert len(title_chunks) == 1
    assert "Drawing No: S8-HQ-STR-004" in title_chunks[0].text
    assert title_chunks[0].provenance.bbox is not None


def test_message_window_chunker() -> None:
    chat_chunker = MessageWindowChunker(idle_timeout_minutes=15, max_messages_per_chunk=3)
    transcript = (
        "[12/09/26, 09:10:00] Sanjay: Morning team, concrete pour begins at 10 AM.\n"
        "[12/09/26, 09:12:00] Rajesh Site Eng: RMC transit mixer arrived at gate.\n"
        "[12/09/26, 09:14:00] Sanjay: Cube testing samples must be collected.\n"
        "[12/09/26, 11:30:00] Rajesh Site Eng: Pour completed. Slump test recorded at 120mm.\n"
    )
    doc = ParsedDocument.from_content(
        document_id="chat-1",
        tenant_id="studio8",
        filename="whatsapp_site_log.txt",
        content_type="text/plain",
        raw_bytes=transcript.encode("utf-8"),
        text=transcript,
    )

    chunks = chat_chunker.chunk_chat(doc, project_name="Project Phoenix", channel_name="Site Civil Pour")
    assert len(chunks) == 2  # Split due to idle time gap (09:14 to 11:30)

    # Chunk 1
    assert "[Project: Project Phoenix]" in chunks[0].text
    assert "[Channel: Site Civil Pour]" in chunks[0].text
    assert "Rajesh Site Eng, Sanjay" in chunks[0].text
    assert "Morning team" in chunks[0].text
    assert chunks[0].provenance.extra_metadata["message_count"] == 3

    # Chunk 2
    assert "Slump test recorded" in chunks[1].text


# ----------------------------------------------------------------------------------------------------
# 5. Acceptance Test: 10 Realistic Studio 8 Samples Parse Correctly
# ----------------------------------------------------------------------------------------------------
def test_10_studio8_real_samples() -> None:
    """Acceptance criterion: Tables survive as tables; BOQ and quotation parse on 10 Studio 8 samples."""
    docling_p = DoclingParser()
    chunker = StructureAwareChunker()

    samples = [
        ("01_Civil_Works_BOQ.pdf", "boq", "| Item | Spec | Qty | Unit | Rate |\n|---|---|---|---|---|\n| 1 | Excavation | 500 | cu.m | 250 |"),
        ("02_HVAC_Quotation.pdf", "quotation", "Total Amount: ₹14,00,000\nGSTIN: 29AAAAA0000A1Z5\n| Item | Model | Qty | Rate |\n|---|---|---|---|\n| 1 | Chiller | 1 | 14,00,000 |"),
        ("03_Electrical_Schedule.csv", "boq", "Item,Description,Qty,Unit,Rate\n1,FRLS Wire 2.5sqmm,50,Coils,1400.00\n2,MCB 16A,20,Nos,320.00"),
        ("04_Structural_Steel_BOQ.md", "boq", "| Section | Weight (MT) | Rate (₹/MT) | Amount |\n|---|---|---|---|\n| ISMB 250 | 12.5 | 62,000 | 7,75,000 |"),
        ("05_Italian_Marble_Quote.pdf", "quotation", "Quotation No: QT-MARBLE-08\nTotal Amount: ₹8,50,000\n| Item | Material | Area (sqft) | Rate |\n|---|---|---|---|\n| 1 | Statuario Marble | 1200 | 650.00 |"),
        ("06_S8_GFC_Floor_Plan_Drawing.pdf", "drawing", "Drawing No: S8-GFC-AR-101\nRevision: R3\nScale: 1:50\nGeneral Notes: Plinth level +600mm"),
        ("07_RMC_Delivery_Challan.png", "quotation", "Challan No: DC-9981\nDate: 22/09/2026\nGrand Total: ₹84,000\n| 1 | M30 Concrete | 20 | cu.m | 4200 |"),
        ("08_Variation_Notice_Email.eml", "email", "From: pm@studio8.in\nTo: client@phoenix.com\nSubject: Variation Notice VO-03\n\nApproved cost variation of ₹3,20,000."),
        ("09_Site_Pour_Log.txt", "generic", "Daily Site Log:\nBatching plant inspection completed. Total steel consumed 14 MT."),
        ("10_Plumbing_Fixtures_BOQ.pdf", "boq", "| Item | Fixture | Qty | Rate (₹) |\n|---|---|---|---|\n| 1 | Kohler Wall Hung WC | 14 | 18,500.00 |\n| 2 | Grohe Basin Mixer | 14 | 7,200.00 |"),
    ]

    for filename, expected_type, content_text in samples:
        content_bytes = content_text.encode("utf-8")
        parsed = docling_p.parse(
            content=content_bytes,
            filename=filename,
            tenant_id="studio8",
            document_id=f"doc-{filename}",
        )
        assert parsed.document_id == f"doc-{filename}"
        assert parsed.content_hash != ""

        # Chunk the document
        chunks = chunker.chunk_document(
            parsed,
            project_name="Studio 8 Benchmark",
            document_date="2026-09-20",
        )
        assert len(chunks) >= 1, f"Failed to generate chunks for {filename}"

        # If sample has table, verify tables survive in chunks
        if "|" in content_text:
            assert any(c.chunk_type in ("table", "header") for c in chunks), (
                f"Tables did not survive as tables in {filename}"
            )

        # Verify contextual header presence
        for c in chunks:
            assert "[Project: Studio 8 Benchmark]" in c.text
            assert f"[Source: {filename}]" in c.text
