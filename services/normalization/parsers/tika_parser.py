# Owner task: EB-30 Document parsing (Docling / Tika) and contextual chunking
"""Tika-compatible and fallback parser for text, HTML, CSV, markdown, and office documents."""

from __future__ import annotations

import csv
import io
import re
from typing import Any

from services.normalization.models import ParsedDocument, ParsedTable
from services.normalization.provenance.spans import BoundingBox


class TikaParser:
    """Tika-style parser providing resilient parsing for unstructured and semi-structured documents.

    Acts as the primary fallback when Docling deep-learning weights or GPU runtimes are unavailable.
    """

    def parse(
        self,
        content: bytes,
        filename: str,
        tenant_id: str,
        document_id: str,
        content_type: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> ParsedDocument:
        """Parses raw content bytes into a normalized ParsedDocument with extracted tables."""
        meta = dict(metadata or {})
        c_type = content_type or self._detect_content_type(filename)

        text = ""
        tables: list[ParsedTable] = []
        page_count = 1

        if c_type in ("text/csv", "application/csv") or filename.endswith(".csv"):
            text, tables = self._parse_csv(content)
        elif c_type in ("text/tab-separated-values",) or filename.endswith((".tsv", ".tab")):
            text, tables = self._parse_tsv(content)
        elif c_type in ("text/html", "application/xhtml+xml") or filename.endswith((".html", ".htm")):
            text, tables = self._parse_html(content)
        elif c_type.startswith("text/") or filename.endswith((".txt", ".md", ".json", ".log")):
            text = self._decode_text(content)
            tables = self._extract_markdown_tables(text)
        else:
            # General binary/pdf/office fallback: attempt text decode or structured extraction
            text = self._decode_text_lenient(content)
            tables = self._extract_markdown_tables(text)

        # Detect estimated page breaks (e.g. form feed character \x0c)
        ff_count = text.count("\x0c")
        if ff_count > 0:
            page_count = max(page_count, ff_count + 1)

        return ParsedDocument.from_content(
            document_id=document_id,
            tenant_id=tenant_id,
            filename=filename,
            content_type=c_type,
            raw_bytes=content,
            text=text,
            tables=tables,
            page_count=page_count,
            metadata=meta,
        )

    def _detect_content_type(self, filename: str) -> str:
        fn = filename.lower()
        if fn.endswith(".pdf"):
            return "application/pdf"
        if fn.endswith(".docx"):
            return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        if fn.endswith(".xlsx"):
            return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        if fn.endswith(".pptx"):
            return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        if fn.endswith(".csv"):
            return "text/csv"
        if fn.endswith(".tsv"):
            return "text/tab-separated-values"
        if fn.endswith((".html", ".htm")):
            return "text/html"
        if fn.endswith(".md"):
            return "text/markdown"
        if fn.endswith(".json"):
            return "application/json"
        return "text/plain"

    def _decode_text(self, content: bytes) -> str:
        for enc in ("utf-8", "utf-8-sig", "latin-1", "cp1252"):
            try:
                return content.decode(enc)
            except UnicodeDecodeError:
                continue
        return content.decode("utf-8", errors="replace")

    def _decode_text_lenient(self, content: bytes) -> str:
        """Leniently decodes text strings from binary blobs (e.g. basic PDF text or streams)."""
        decoded = self._decode_text(content)
        # Filter printable strings if it looks like binary
        printable_ratio = sum(c.isprintable() or c in "\n\r\t" for c in decoded) / max(len(decoded), 1)
        if printable_ratio < 0.6:
            # Extract printable character chunks of length >= 4
            chunks = re.findall(r"[A-Za-z0-9\s.,;:_₹$€¥#%&*()/\-+=<>?!@\[\]]{4,}", decoded)
            return "\n".join(chunks)
        return decoded

    def _parse_csv(self, content: bytes) -> tuple[str, list[ParsedTable]]:
        text_str = self._decode_text(content)
        reader = csv.reader(io.StringIO(text_str))
        rows = [row for row in reader if any(cell.strip() for cell in row)]
        if not rows:
            return "", []

        headers = rows[0]
        body_rows = rows[1:] if len(rows) > 1 else []
        table = ParsedTable(
            headers=headers,
            rows=body_rows,
            page_no=1,
            bbox=BoundingBox(page=1, x0=50.0, y0=50.0, x1=950.0, y1=900.0),
        )
        return table.to_markdown(), [table]

    def _parse_tsv(self, content: bytes) -> tuple[str, list[ParsedTable]]:
        text_str = self._decode_text(content)
        reader = csv.reader(io.StringIO(text_str), delimiter="\t")
        rows = [row for row in reader if any(cell.strip() for cell in row)]
        if not rows:
            return "", []

        headers = rows[0]
        body_rows = rows[1:] if len(rows) > 1 else []
        table = ParsedTable(
            headers=headers,
            rows=body_rows,
            page_no=1,
            bbox=BoundingBox(page=1, x0=50.0, y0=50.0, x1=950.0, y1=900.0),
        )
        return table.to_markdown(), [table]

    def _parse_html(self, content: bytes) -> tuple[str, list[ParsedTable]]:
        html_str = self._decode_text(content)
        tables: list[ParsedTable] = []

        # Find <table>...</table> blocks
        table_matches = re.findall(r"<table[^>]*>(.*?)</table>", html_str, re.IGNORECASE | re.DOTALL)
        for idx, t_html in enumerate(table_matches):
            headers: list[str] = []
            th_matches = re.findall(r"<th[^>]*>(.*?)</th>", t_html, re.IGNORECASE | re.DOTALL)
            if th_matches:
                headers = [re.sub(r"<[^>]+>", "", th).strip() for th in th_matches]

            rows: list[list[str]] = []
            tr_matches = re.findall(r"<tr[^>]*>(.*?)</tr>", t_html, re.IGNORECASE | re.DOTALL)
            for tr in tr_matches:
                tds = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.IGNORECASE | re.DOTALL)
                if tds:
                    rows.append([re.sub(r"<[^>]+>", "", td).strip() for td in tds])

            if headers or rows:
                if not headers and rows:
                    headers = [f"Col {i+1}" for i in range(len(rows[0]))]
                tables.append(
                    ParsedTable(
                        title=f"HTML Table {idx+1}",
                        headers=headers,
                        rows=rows,
                        page_no=1,
                        bbox=BoundingBox(page=1, x0=50.0, y0=100.0 + idx * 200, x1=950.0, y1=280.0 + idx * 200),
                    )
                )

        clean_text = re.sub(r"<[^>]+>", " ", html_str)
        clean_text = re.sub(r"\s+", " ", clean_text).strip()
        return clean_text, tables

    def _extract_markdown_tables(self, text: str) -> list[ParsedTable]:
        """Detects ASCII / Markdown pipe tables in text blocks."""
        tables: list[ParsedTable] = []
        lines = text.splitlines()
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            if line.startswith("|") and line.endswith("|"):
                # Case 1: Standard markdown table with separator line
                if i + 1 < len(lines) and re.match(r"^\|(\s*:?-+:?\s*\|)+$", lines[i + 1].strip()):
                    headers = [c.strip() for c in line.strip("|").split("|")]
                    rows: list[list[str]] = []
                    j = i + 2
                    while j < len(lines) and lines[j].strip().startswith("|") and lines[j].strip().endswith("|"):
                        row_cells = [c.strip() for c in lines[j].strip("|").split("|")]
                        rows.append(row_cells)
                        j += 1

                    tables.append(
                        ParsedTable(
                            headers=headers,
                            rows=rows,
                            page_no=1,
                            bbox=BoundingBox(page=1, x0=50.0, y0=100.0, x1=950.0, y1=600.0),
                        )
                    )
                    i = j
                    continue
                else:
                    # Case 2: Pipe separated lines without explicit separator
                    pipe_rows: list[list[str]] = []
                    j = i
                    while j < len(lines) and lines[j].strip().startswith("|") and lines[j].strip().endswith("|"):
                        cells = [c.strip() for c in lines[j].strip("|").split("|")]
                        if any(c for c in cells):
                            pipe_rows.append(cells)
                        j += 1

                    if pipe_rows:
                        headers = [f"Col {k+1}" for k in range(len(pipe_rows[0]))]
                        tables.append(
                            ParsedTable(
                                headers=headers,
                                rows=pipe_rows,
                                page_no=1,
                                bbox=BoundingBox(page=1, x0=50.0, y0=100.0, x1=950.0, y1=600.0),
                            )
                        )
                    i = j
                    continue
            i += 1
        return tables
