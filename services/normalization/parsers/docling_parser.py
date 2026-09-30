# Owner task: EB-30 Document parsing (Docling / Tika) and contextual chunking
"""Docling-based document parser with automatic Tika fallback for PDF, DOCX, PPTX, and XLSX."""

from __future__ import annotations

import logging
from typing import Any

from services.normalization.models import ParsedDocument, ParsedTable
from services.normalization.parsers.ocr import OCRParser
from services.normalization.parsers.tika_parser import TikaParser
from services.normalization.provenance.spans import BoundingBox

logger = logging.getLogger(__name__)

# Check if docling runtime is available
_HAS_DOCLING = False
try:
    import docling  # type: ignore # noqa: F401
    _HAS_DOCLING = True
except ImportError:
    _HAS_DOCLING = False


class DoclingParser:
    """Primary document parser using IBM's Docling (TableFormer & layout recognition).

    Falls back seamlessly to TikaParser if Docling is not installed or fails during extraction.
    Routes images (.png, .jpg) directly to OCRParser.
    """

    def __init__(self, fallback_parser: TikaParser | None = None, ocr_parser: OCRParser | None = None) -> None:
        self.fallback = fallback_parser or TikaParser()
        self.ocr = ocr_parser or OCRParser()

    def parse(
        self,
        content: bytes,
        filename: str,
        tenant_id: str,
        document_id: str,
        content_type: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> ParsedDocument:
        """Parses document bytes into a ParsedDocument preserving tables and bounding boxes."""
        meta = dict(metadata or {})

        # Route images to OCR
        fn = filename.lower()
        if fn.endswith((".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".webp")) or (
            content_type and content_type.startswith("image/")
        ):
            return self.ocr.parse(
                content=content,
                filename=filename,
                tenant_id=tenant_id,
                document_id=document_id,
                content_type=content_type,
                metadata=meta,
            )

        if not _HAS_DOCLING:
            meta["parser_engine"] = "tika_fallback"
            return self.fallback.parse(
                content=content,
                filename=filename,
                tenant_id=tenant_id,
                document_id=document_id,
                content_type=content_type,
                metadata=meta,
            )

        try:
            return self._parse_with_docling(
                content=content,
                filename=filename,
                tenant_id=tenant_id,
                document_id=document_id,
                content_type=content_type,
                metadata=meta,
            )
        except Exception as exc:
            logger.warning(
                "Docling parsing failed for %s (id: %s), falling back to Tika: %s",
                filename,
                document_id,
                exc,
            )
            meta["parser_engine"] = "tika_fallback"
            meta["docling_error"] = str(exc)
            return self.fallback.parse(
                content=content,
                filename=filename,
                tenant_id=tenant_id,
                document_id=document_id,
                content_type=content_type,
                metadata=meta,
            )

    def _parse_with_docling(
        self,
        content: bytes,
        filename: str,
        tenant_id: str,
        document_id: str,
        content_type: str | None,
        metadata: dict[str, Any],
    ) -> ParsedDocument:
        """Internal execution via Docling DocumentConverter."""
        from docling.datamodel.base_models import DocumentStream  # type: ignore
        from docling.document_converter import DocumentConverter  # type: ignore
        import io

        converter = DocumentConverter()
        stream = DocumentStream(name=filename, stream=io.BytesIO(content))
        result = converter.convert(stream)
        doc = result.document

        # Extract markdown text and structured tables
        md_text = doc.export_to_markdown()
        tables: list[ParsedTable] = []

        for idx, table_item in enumerate(doc.tables):
            # Extract header and grid rows
            df = table_item.export_to_dataframe()
            headers = [str(col) for col in df.columns]
            rows = [[str(val) for val in row] for row in df.values.tolist()]

            bbox: BoundingBox | None = None
            page_no = 1
            if hasattr(table_item, "prov") and table_item.prov:
                p = table_item.prov[0]
                page_no = getattr(p, "page_no", 1)
                if hasattr(p, "bbox") and p.bbox:
                    bbox = BoundingBox(
                        page=page_no,
                        x0=float(p.bbox.l),
                        y0=float(p.bbox.t),
                        x1=float(p.bbox.r),
                        y1=float(p.bbox.b),
                    )

            tables.append(
                ParsedTable(
                    title=f"Table {idx+1}",
                    headers=headers,
                    rows=rows,
                    page_no=page_no,
                    bbox=bbox,
                )
            )

        page_count = len(doc.pages) if hasattr(doc, "pages") else 1
        metadata["parser_engine"] = "docling"

        return ParsedDocument.from_content(
            document_id=document_id,
            tenant_id=tenant_id,
            filename=filename,
            content_type=content_type or "application/octet-stream",
            raw_bytes=content,
            text=md_text,
            tables=tables,
            page_count=page_count,
            metadata=metadata,
        )
