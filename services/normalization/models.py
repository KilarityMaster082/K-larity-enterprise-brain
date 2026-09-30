# Owner task: EB-30 Document parsing (Docling / Tika) and contextual chunking
"""Core data models for parsed documents, tables, and normalized document chunks."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
import hashlib
from typing import Any

from services.normalization.provenance.spans import BoundingBox, ProvenanceSpan


@dataclass
class ParsedTable:
    """Structured representation of an extracted table (e.g. from BOQ, quotation, schedule).

    Preserves row/column hierarchy, column headers, cell values, and spatial coordinates.
    """

    headers: list[str]
    rows: list[list[str]]
    title: str | None = None
    page_no: int | None = None
    bbox: BoundingBox | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_markdown(self) -> str:
        """Renders the table as a clean GitHub Flavored Markdown table."""
        if not self.headers and not self.rows:
            return ""

        headers = self.headers if self.headers else [f"Col {i+1}" for i in range(len(self.rows[0]))]
        col_count = len(headers)

        lines: list[str] = []
        if self.title:
            lines.append(f"### {self.title}")

        header_line = "| " + " | ".join(h.replace("|", "\\|").strip() for h in headers) + " |"
        sep_line = "| " + " | ".join("---" for _ in range(col_count)) + " |"
        lines.append(header_line)
        lines.append(sep_line)

        for row in self.rows:
            # Pad or truncate to match header count
            padded_row = list(row) + [""] * (col_count - len(row))
            row_cells = [str(cell).replace("|", "\\|").strip() for cell in padded_row[:col_count]]
            lines.append("| " + " | ".join(row_cells) + " |")

        return "\n".join(lines)

    def to_html(self) -> str:
        """Renders table as an HTML snippet."""
        lines = ["<table>"]
        if self.title:
            lines.append(f"  <caption>{self.title}</caption>")
        if self.headers:
            lines.append("  <thead><tr>")
            for h in self.headers:
                lines.append(f"    <th>{h}</th>")
            lines.append("  </tr></thead>")
        lines.append("  <tbody>")
        for row in self.rows:
            lines.append("    <tr>")
            for cell in row:
                lines.append(f"      <td>{cell}</td>")
            lines.append("    </tr>")
        lines.append("  </tbody>")
        lines.append("</table>")
        return "\n".join(lines)


@dataclass
class ParsedDocument:
    """The normalized output of a document parser (Docling, Tika, OCR).

    Contains the full extracted text, recognized tables, page count, and document metadata.
    """

    document_id: str
    tenant_id: str
    filename: str
    content_type: str
    content_hash: str
    text: str
    tables: list[ParsedTable] = field(default_factory=list)
    page_count: int = 1
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_content(
        cls,
        *,
        document_id: str,
        tenant_id: str,
        filename: str,
        content_type: str,
        raw_bytes: bytes,
        text: str,
        tables: list[ParsedTable] | None = None,
        page_count: int = 1,
        metadata: dict[str, Any] | None = None,
    ) -> ParsedDocument:
        content_hash = hashlib.sha256(raw_bytes).hexdigest()
        return cls(
            document_id=document_id,
            tenant_id=tenant_id,
            filename=filename,
            content_type=content_type,
            content_hash=content_hash,
            text=text,
            tables=tables or [],
            page_count=page_count,
            metadata=metadata or {},
        )


@dataclass
class DocumentChunk:
    """A semantic chunk of a parsed document ready for embedding and vector/lexical retrieval.

    Includes the contextual header prepended to the chunk text, exact provenance span,
    and associated structured table data if the chunk represents a tabular section.
    """

    chunk_id: str
    document_id: str
    tenant_id: str
    chunk_index: int
    text: str
    raw_content: str
    token_count: int
    chunk_type: str  # "text", "table", "cad_title", "email_envelope", "chat_window"
    provenance: ProvenanceSpan
    table_data: ParsedTable | None = None
    context_header: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "chunk_id": self.chunk_id,
            "document_id": self.document_id,
            "tenant_id": self.tenant_id,
            "chunk_index": self.chunk_index,
            "text": self.text,
            "raw_content": self.raw_content,
            "token_count": self.token_count,
            "chunk_type": self.chunk_type,
            "provenance": self.provenance.to_dict(),
            "table_data": asdict(self.table_data) if self.table_data else None,
            "context_header": self.context_header,
        }
