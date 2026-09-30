# Owner task: EB-30 Document parsing (Docling / Tika) and contextual chunking
"""OCR and document information extraction for scanned bills, invoices, receipts, and site photos."""

from __future__ import annotations

import logging
import re
from typing import Any

from services.normalization.models import ParsedDocument, ParsedTable
from services.normalization.provenance.spans import BoundingBox

logger = logging.getLogger(__name__)

# Indian GSTIN regex: 2 digits state code, 5 letters PAN, 4 digits, 1 letter, 1 entity digit, Z, 1 check digit
GSTIN_REGEX = re.compile(r"\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}Z[A-Z\d]{1}\b")
# Indian Date formats: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
DATE_REGEX = re.compile(r"\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})\b")
# Amount formats: ₹ or Rs. followed by Indian numbering (e.g. 1,50,000.00 or 150000.00)
AMOUNT_REGEX = re.compile(r"(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{2})?)", re.IGNORECASE)


class OCRParser:
    """Specialized OCR and financial entity extractor for scanned AEC bills and site delivery receipts."""

    def __init__(self) -> None:
        self._has_tesseract = False
        try:
            import pytesseract  # type: ignore # noqa: F401
            self._has_tesseract = True
        except ImportError:
            self._has_tesseract = False

    def parse(
        self,
        content: bytes,
        filename: str,
        tenant_id: str,
        document_id: str,
        content_type: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> ParsedDocument:
        """Extracts text and key invoice fields from scanned images or text representations."""
        meta = dict(metadata or {})
        raw_text = self._extract_raw_text(content, filename)

        # Extract structured invoice / bill metadata
        fields = self.extract_invoice_fields(raw_text)
        meta.update(fields)
        meta["is_scanned_ocr"] = True

        # Extract itemized bill lines into a ParsedTable
        tables = self._extract_bill_table(raw_text)

        return ParsedDocument.from_content(
            document_id=document_id,
            tenant_id=tenant_id,
            filename=filename,
            content_type=content_type or "image/png",
            raw_bytes=content,
            text=raw_text,
            tables=tables,
            page_count=1,
            metadata=meta,
        )

    def _extract_raw_text(self, content: bytes, filename: str) -> str:
        """Extracts text using pytesseract if available, or falls back to text decoding."""
        if self._has_tesseract:
            try:
                import io
                from PIL import Image  # type: ignore
                import pytesseract  # type: ignore

                img = Image.open(io.BytesIO(content))
                return pytesseract.image_to_string(img)
            except Exception as e:
                logger.warning("Pytesseract extraction failed for %s: %s", filename, e)

        # Fallback to text decoding
        for enc in ("utf-8", "latin-1", "cp1252"):
            try:
                decoded = content.decode(enc)
                # Check if it has readable text
                if sum(c.isalnum() for c in decoded) > 10:
                    return decoded
            except UnicodeDecodeError:
                continue

        return f"[Scanned Image / Site Photo: {filename}]"

    def extract_invoice_fields(self, text: str) -> dict[str, Any]:
        """Extracts key financial fields from OCR text (GSTIN, dates, totals, invoice numbers)."""
        fields: dict[str, Any] = {}

        # 1. GSTIN
        gstin_match = GSTIN_REGEX.search(text)
        if gstin_match:
            fields["gstin"] = gstin_match.group(0)

        # 2. Date
        date_match = DATE_REGEX.search(text)
        if date_match:
            fields["invoice_date"] = date_match.group(0)

        # 3. Invoice / Bill / Challan Number
        inv_match = re.search(
            r"(?:Invoice\s*(?:No|Number|#)|Bill\s*(?:No|#)|Challan\s*(?:No|#))[:.\s]*([A-Za-z0-9\-_/]+)",
            text,
            re.IGNORECASE,
        )
        if inv_match:
            fields["invoice_number"] = inv_match.group(1).strip()

        # 4. Total Amount
        total_match = re.search(
            r"(?:Total\s*Amount|Grand\s*Total|Invoice\s*Total|Net\s*Amount)[:.\s]*(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{2})?)",
            text,
            re.IGNORECASE,
        )
        if total_match:
            raw_amt = total_match.group(1).replace(",", "")
            try:
                fields["total_amount"] = float(raw_amt)
                fields["currency"] = "INR"
            except ValueError:
                pass
        else:
            # Fallback: scan for any explicit currency amount
            amt_matches = AMOUNT_REGEX.findall(text)
            if amt_matches:
                last_amt = amt_matches[-1].replace(",", "")
                try:
                    fields["total_amount"] = float(last_amt)
                    fields["currency"] = "INR"
                except ValueError:
                    pass

        # 5. Vendor / Contractor Name
        vendor_match = re.search(r"^(?:M/s\.?|To:?)\s*([A-Za-z0-9\s.,&'-]{3,50})", text, re.MULTILINE)
        if vendor_match:
            fields["vendor_name"] = vendor_match.group(1).strip()

        return fields

    def _extract_bill_table(self, text: str) -> list[ParsedTable]:
        """Extracts structured line items from bill text."""
        lines = text.splitlines()
        rows: list[list[str]] = []
        headers = ["Item No", "Description", "Qty", "Unit", "Rate (₹)", "Amount (₹)"]

        for line in lines:
            # Match standard bill line item format: e.g. "1 | Cement Bags 53 Grade | 100 | Bags | 420.00 | 42,000.00"
            parts = [p.strip() for p in line.split("|") if p.strip()]
            if len(parts) >= 4 and any(c.isdigit() for c in parts[-1]):
                rows.append(parts)
            else:
                # Regex heuristic for line: e.g. "1. Ready Mix Concrete M25 20 cu.m 4500.00 90000.00"
                m = re.match(
                    r"^(\d+)[\.\s]+(.+?)\s+(\d+(?:\.\d+)?)\s+([A-Za-z.]+)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)$",
                    line.strip(),
                )
                if m:
                    rows.append([m.group(1), m.group(2).strip(), m.group(3), m.group(4), m.group(5), m.group(6)])

        if not rows:
            return []

        table = ParsedTable(
            title="Bill Line Items",
            headers=headers[: len(rows[0])] if len(rows[0]) <= len(headers) else [f"Col {i+1}" for i in range(len(rows[0]))],
            rows=rows,
            page_no=1,
            bbox=BoundingBox(page=1, x0=50.0, y0=250.0, x1=950.0, y1=750.0),
        )
        return [table]
