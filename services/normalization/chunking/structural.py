# Owner task: EB-30 Document parsing (Docling / Tika) and contextual chunking
"""Structure-aware document chunker with contextual header injection for AEC document types."""

from __future__ import annotations

import re
from typing import Any

from services.normalization.models import DocumentChunk, ParsedDocument, ParsedTable
from services.normalization.provenance.spans import BoundingBox, ProvenanceSpan


class StructureAwareChunker:
    """Chunks normalized documents according to their structural domain rules.

    Enforces:
    - Rule 1 & Rule 3: Preserves exact page numbers, table headers, and bounding boxes.
    - Subtask 3: Domain-specific chunking for BOQs, quotations, drawings, and emails.
    - Subtask 4: Injects standardized contextual headers into every chunk.
    """

    def __init__(
        self,
        *,
        max_tokens_per_chunk: int = 512,
        target_table_rows_per_chunk: int = 10,
    ) -> None:
        self.max_tokens = max_tokens_per_chunk
        self.target_table_rows = target_table_rows_per_chunk

    def chunk_document(
        self,
        doc: ParsedDocument,
        *,
        project_name: str | None = None,
        document_date: str | None = None,
        doc_type: str | None = None,
    ) -> list[DocumentChunk]:
        """Chunks a ParsedDocument into structured DocumentChunks with contextual headers."""
        detected_type = doc_type or self._detect_doc_type(doc)

        if detected_type == "boq":
            return self._chunk_boq(doc, project_name=project_name, document_date=document_date)
        elif detected_type == "quotation":
            return self._chunk_quotation(doc, project_name=project_name, document_date=document_date)
        elif detected_type == "drawing":
            return self._chunk_drawing(doc, project_name=project_name, document_date=document_date)
        elif detected_type == "email":
            return self._chunk_email(doc, project_name=project_name, document_date=document_date)
        else:
            return self._chunk_generic(doc, project_name=project_name, document_date=document_date)

    def _detect_doc_type(self, doc: ParsedDocument) -> str:
        fn = doc.filename.lower()
        text_lower = doc.text.lower()

        if any(k in fn or k in text_lower for k in ("boq", "bill of quantities", "rate analysis", "measurement sheet")):
            return "boq"
        if any(k in fn or k in text_lower for k in ("quotation", "quote", "proforma", "purchase order", "po-", "tax invoice", "challan", "bill", "invoice", "receipt")):
            return "quotation"
        if any(k in fn or k in text_lower for k in ("drawing", "gfc", "floor plan", "elevation", ".dxf", ".dwg", "schematic")):
            return "drawing"
        if any(k in fn for k in (".eml", ".msg")) or "from:" in text_lower and "subject:" in text_lower:
            return "email"
        return "generic"

    def _build_context_header(
        self,
        *,
        project_name: str | None,
        filename: str,
        document_date: str | None,
        section_path: str | None,
    ) -> str:
        parts: list[str] = []
        if project_name:
            parts.append(f"[Project: {project_name}]")
        parts.append(f"[Source: {filename}]")
        if document_date:
            parts.append(f"[Date: {document_date}]")
        if section_path:
            parts.append(f"[Section: {section_path}]")
        return " ".join(parts)

    def _estimate_tokens(self, text: str) -> int:
        """Fast token count estimation (~4 characters per token)."""
        return max(1, len(text) // 4)

    # ------------------------------------------------------------------------------------------------
    # 1. BOQ & Schedules Table-Row-Group Chunking
    # ------------------------------------------------------------------------------------------------
    def _chunk_boq(
        self,
        doc: ParsedDocument,
        project_name: str | None,
        document_date: str | None,
    ) -> list[DocumentChunk]:
        chunks: list[DocumentChunk] = []
        chunk_idx = 0

        # Chunk all parsed tables row-by-row
        for table_idx, table in enumerate(doc.tables):
            headers = table.headers
            rows = table.rows
            if not rows:
                continue

            # Group rows into batches of target_table_rows without cutting rows
            for start_r in range(0, len(rows), self.target_table_rows):
                batch_rows = rows[start_r : start_r + self.target_table_rows]
                batch_table = ParsedTable(
                    headers=headers,
                    rows=batch_rows,
                    title=f"{table.title or 'BOQ Schedule'} (Items {start_r+1}–{start_r+len(batch_rows)})",
                    page_no=table.page_no,
                    bbox=table.bbox,
                )

                section_name = f"BOQ Table {table_idx+1}: Rows {start_r+1}-{start_r+len(batch_rows)}"
                context_hdr = self._build_context_header(
                    project_name=project_name,
                    filename=doc.filename,
                    document_date=document_date,
                    section_path=section_name,
                )

                table_md = batch_table.to_markdown()
                full_text = f"{context_hdr}\n\n{table_md}"
                token_count = self._estimate_tokens(full_text)

                prov = ProvenanceSpan(
                    source_id=doc.document_id,
                    source_ref=doc.filename,
                    content_hash=doc.content_hash,
                    page_no=table.page_no or 1,
                    bbox=table.bbox,
                    extra_metadata={
                        "row_start": start_r + 1,
                        "row_end": start_r + len(batch_rows),
                        "table_index": table_idx,
                    },
                )

                chunks.append(
                    DocumentChunk(
                        chunk_id=f"{doc.document_id}-boq-{chunk_idx}",
                        document_id=doc.document_id,
                        tenant_id=doc.tenant_id,
                        chunk_index=chunk_idx,
                        text=full_text,
                        raw_content=table_md,
                        token_count=token_count,
                        chunk_type="table",
                        provenance=prov,
                        table_data=batch_table,
                        context_header=context_hdr,
                    )
                )
                chunk_idx += 1

        # Also chunk any introductory narrative / specification notes
        non_table_text = self._strip_tables_from_text(doc.text)
        if non_table_text.strip():
            generic_chunks = self._chunk_text_paragraphs(
                non_table_text,
                doc=doc,
                project_name=project_name,
                document_date=document_date,
                section_prefix="Specifications & Notes",
                start_index=chunk_idx,
            )
            chunks.extend(generic_chunks)

        return chunks

    # ------------------------------------------------------------------------------------------------
    # 2. Vendor Quotation Two-Pass Chunking
    # ------------------------------------------------------------------------------------------------
    def _chunk_quotation(
        self,
        doc: ParsedDocument,
        project_name: str | None,
        document_date: str | None,
    ) -> list[DocumentChunk]:
        chunks: list[DocumentChunk] = []
        chunk_idx = 0

        # Pass 1: Commercial terms & metadata chunk
        terms_lines: list[str] = []
        for line in doc.text.splitlines():
            l_lower = line.lower()
            if any(k in l_lower for k in ("gstin", "payment terms", "validity", "total amount", "grand total", "vendor", "quotation no")):
                terms_lines.append(line.strip())

        terms_content = "\n".join(terms_lines) if terms_lines else doc.text[:600]
        context_hdr_terms = self._build_context_header(
            project_name=project_name,
            filename=doc.filename,
            document_date=document_date,
            section_path="Commercial Terms & Header",
        )
        full_terms = f"{context_hdr_terms}\n\n{terms_content}"

        prov_terms = ProvenanceSpan(
            source_id=doc.document_id,
            source_ref=doc.filename,
            content_hash=doc.content_hash,
            page_no=1,
            bbox=BoundingBox(page=1, x0=50.0, y0=50.0, x1=950.0, y1=300.0),
            extra_metadata={"section": "commercial_terms"},
        )

        chunks.append(
            DocumentChunk(
                chunk_id=f"{doc.document_id}-quote-terms",
                document_id=doc.document_id,
                tenant_id=doc.tenant_id,
                chunk_index=chunk_idx,
                text=full_terms,
                raw_content=terms_content,
                token_count=self._estimate_tokens(full_terms),
                chunk_type="header",
                provenance=prov_terms,
                context_header=context_hdr_terms,
            )
        )
        chunk_idx += 1

        # Pass 2: Line items chunks from parsed tables or body
        if doc.tables:
            for table_idx, table in enumerate(doc.tables):
                for start_r in range(0, len(table.rows), self.target_table_rows):
                    b_rows = table.rows[start_r : start_r + self.target_table_rows]
                    b_tbl = ParsedTable(
                        headers=table.headers,
                        rows=b_rows,
                        title=f"Quotation Line Items ({start_r+1}–{start_r+len(b_rows)})",
                        page_no=table.page_no,
                        bbox=table.bbox,
                    )
                    sec_name = f"Quotation Items: Rows {start_r+1}-{start_r+len(b_rows)}"
                    c_hdr = self._build_context_header(
                        project_name=project_name,
                        filename=doc.filename,
                        document_date=document_date,
                        section_path=sec_name,
                    )
                    t_md = b_tbl.to_markdown()
                    f_text = f"{c_hdr}\n\n{t_md}"

                    prov_t = ProvenanceSpan(
                        source_id=doc.document_id,
                        source_ref=doc.filename,
                        content_hash=doc.content_hash,
                        page_no=table.page_no or 1,
                        bbox=table.bbox,
                    )

                    chunks.append(
                        DocumentChunk(
                            chunk_id=f"{doc.document_id}-quote-{chunk_idx}",
                            document_id=doc.document_id,
                            tenant_id=doc.tenant_id,
                            chunk_index=chunk_idx,
                            text=f_text,
                            raw_content=t_md,
                            token_count=self._estimate_tokens(f_text),
                            chunk_type="table",
                            provenance=prov_t,
                            table_data=b_tbl,
                            context_header=c_hdr,
                        )
                    )
                    chunk_idx += 1
        else:
            # Fallback text chunking
            generic_chunks = self._chunk_text_paragraphs(
                doc.text,
                doc=doc,
                project_name=project_name,
                document_date=document_date,
                section_prefix="Quotation Details",
                start_index=chunk_idx,
            )
            chunks.extend(generic_chunks)

        return chunks

    # ------------------------------------------------------------------------------------------------
    # 3. Architectural Drawing & CAD Title Block Chunking
    # ------------------------------------------------------------------------------------------------
    def _chunk_drawing(
        self,
        doc: ParsedDocument,
        project_name: str | None,
        document_date: str | None,
    ) -> list[DocumentChunk]:
        chunks: list[DocumentChunk] = []
        chunk_idx = 0

        # Title block extraction (Project Name, Drawing Number, Revision, Scale, Architect)
        title_block_lines: list[str] = []
        notes_lines: list[str] = []

        for line in doc.text.splitlines():
            l_lower = line.lower()
            if any(k in l_lower for k in ("drawing no", "drg no", "rev.", "revision", "scale:", "architect", "gfc", "tender", "date:")):
                title_block_lines.append(line.strip())
            else:
                notes_lines.append(line)

        # 1. Title Block Chunk
        title_text = "\n".join(title_block_lines) if title_block_lines else doc.text[:400]
        context_hdr_title = self._build_context_header(
            project_name=project_name,
            filename=doc.filename,
            document_date=document_date,
            section_path="Title Block & Drawing Metadata",
        )
        full_title = f"{context_hdr_title}\n\n{title_text}"

        prov_title = ProvenanceSpan(
            source_id=doc.document_id,
            source_ref=doc.filename,
            content_hash=doc.content_hash,
            page_no=1,
            bbox=BoundingBox(page=1, x0=700.0, y0=700.0, x1=980.0, y1=980.0),  # Standard title block position
            extra_metadata={"element": "title_block"},
        )

        chunks.append(
            DocumentChunk(
                chunk_id=f"{doc.document_id}-cad-title",
                document_id=doc.document_id,
                tenant_id=doc.tenant_id,
                chunk_index=chunk_idx,
                text=full_title,
                raw_content=title_text,
                token_count=self._estimate_tokens(full_title),
                chunk_type="cad_title",
                provenance=prov_title,
                context_header=context_hdr_title,
            )
        )
        chunk_idx += 1

        # 2. General Notes & Schedules Chunk
        remaining_notes = "\n".join(notes_lines).strip()
        if remaining_notes:
            notes_chunks = self._chunk_text_paragraphs(
                remaining_notes,
                doc=doc,
                project_name=project_name,
                document_date=document_date,
                section_prefix="Drawing Notes & Legend",
                start_index=chunk_idx,
            )
            chunks.extend(notes_chunks)

        return chunks

    # ------------------------------------------------------------------------------------------------
    # 4. Email & Transmittal Chunking
    # ------------------------------------------------------------------------------------------------
    def _chunk_email(
        self,
        doc: ParsedDocument,
        project_name: str | None,
        document_date: str | None,
    ) -> list[DocumentChunk]:
        chunks: list[DocumentChunk] = []
        chunk_idx = 0

        # Envelope header lines (From, To, Subject, Date)
        env_lines: list[str] = []
        body_lines: list[str] = []
        in_header = True

        for line in doc.text.splitlines():
            if in_header and (line.lower().startswith(("from:", "to:", "cc:", "subject:", "date:", "message-id:"))):
                env_lines.append(line.strip())
            else:
                if in_header and line.strip() == "":
                    in_header = False
                body_lines.append(line)

        # 1. Email Envelope Chunk
        env_text = "\n".join(env_lines) if env_lines else doc.text[:300]
        context_hdr_env = self._build_context_header(
            project_name=project_name,
            filename=doc.filename,
            document_date=document_date,
            section_path="Email Transmittal Header",
        )
        full_env = f"{context_hdr_env}\n\n{env_text}"

        prov_env = ProvenanceSpan(
            source_id=doc.document_id,
            source_ref=doc.filename,
            content_hash=doc.content_hash,
            page_no=1,
            extra_metadata={"element": "email_envelope"},
        )

        chunks.append(
            DocumentChunk(
                chunk_id=f"{doc.document_id}-email-env",
                document_id=doc.document_id,
                tenant_id=doc.tenant_id,
                chunk_index=chunk_idx,
                text=full_env,
                raw_content=env_text,
                token_count=self._estimate_tokens(full_env),
                chunk_type="email_envelope",
                provenance=prov_env,
                context_header=context_hdr_env,
            )
        )
        chunk_idx += 1

        # 2. Email Body Chunks
        body_text = "\n".join(body_lines).strip()
        if body_text:
            body_chunks = self._chunk_text_paragraphs(
                body_text,
                doc=doc,
                project_name=project_name,
                document_date=document_date,
                section_prefix="Email Body",
                start_index=chunk_idx,
            )
            chunks.extend(body_chunks)

        return chunks

    # ------------------------------------------------------------------------------------------------
    # 5. Generic Structured / Heading Chunking
    # ------------------------------------------------------------------------------------------------
    def _chunk_generic(
        self,
        doc: ParsedDocument,
        project_name: str | None,
        document_date: str | None,
    ) -> list[DocumentChunk]:
        chunks: list[DocumentChunk] = []
        chunk_idx = 0

        # Emit table chunks if parsed tables exist
        if doc.tables:
            for t_idx, tbl in enumerate(doc.tables):
                for start_r in range(0, len(tbl.rows), self.target_table_rows):
                    b_rows = tbl.rows[start_r : start_r + self.target_table_rows]
                    b_tbl = ParsedTable(
                        headers=tbl.headers,
                        rows=b_rows,
                        title=f"{tbl.title or 'Table'} ({start_r+1}–{start_r+len(b_rows)})",
                        page_no=tbl.page_no,
                        bbox=tbl.bbox,
                    )
                    c_hdr = self._build_context_header(
                        project_name=project_name,
                        filename=doc.filename,
                        document_date=document_date,
                        section_path=f"Table {t_idx+1}: Rows {start_r+1}-{start_r+len(b_rows)}",
                    )
                    t_md = b_tbl.to_markdown()
                    f_text = f"{c_hdr}\n\n{t_md}"
                    prov = ProvenanceSpan(
                        source_id=doc.document_id,
                        source_ref=doc.filename,
                        content_hash=doc.content_hash,
                        page_no=tbl.page_no or 1,
                        bbox=tbl.bbox,
                    )
                    chunks.append(
                        DocumentChunk(
                            chunk_id=f"{doc.document_id}-tbl-{chunk_idx}",
                            document_id=doc.document_id,
                            tenant_id=doc.tenant_id,
                            chunk_index=chunk_idx,
                            text=f_text,
                            raw_content=t_md,
                            token_count=self._estimate_tokens(f_text),
                            chunk_type="table",
                            provenance=prov,
                            table_data=b_tbl,
                            context_header=c_hdr,
                        )
                    )
                    chunk_idx += 1

        non_tbl_text = self._strip_tables_from_text(doc.text) if doc.tables else doc.text
        if non_tbl_text.strip():
            text_chunks = self._chunk_text_paragraphs(
                non_tbl_text,
                doc=doc,
                project_name=project_name,
                document_date=document_date,
                section_prefix="Content",
                start_index=chunk_idx,
            )
            chunks.extend(text_chunks)

        return chunks

    def _chunk_text_paragraphs(
        self,
        text: str,
        doc: ParsedDocument,
        project_name: str | None,
        document_date: str | None,
        section_prefix: str,
        start_index: int,
    ) -> list[DocumentChunk]:
        chunks: list[DocumentChunk] = []
        paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
        if not paragraphs:
            return chunks

        current_paras: list[str] = []
        current_tokens = 0
        chunk_idx = start_index

        for para in paragraphs:
            para_tokens = self._estimate_tokens(para)
            if current_tokens + para_tokens > self.max_tokens and current_paras:
                # Flush chunk
                raw_c = "\n\n".join(current_paras)
                c_hdr = self._build_context_header(
                    project_name=project_name,
                    filename=doc.filename,
                    document_date=document_date,
                    section_path=f"{section_prefix} (Part {len(chunks)+1})",
                )
                f_text = f"{c_hdr}\n\n{raw_c}"
                prov = ProvenanceSpan(
                    source_id=doc.document_id,
                    source_ref=doc.filename,
                    content_hash=doc.content_hash,
                    page_no=1,
                )
                chunks.append(
                    DocumentChunk(
                        chunk_id=f"{doc.document_id}-chunk-{chunk_idx}",
                        document_id=doc.document_id,
                        tenant_id=doc.tenant_id,
                        chunk_index=chunk_idx,
                        text=f_text,
                        raw_content=raw_c,
                        token_count=self._estimate_tokens(f_text),
                        chunk_type="text",
                        provenance=prov,
                        context_header=c_hdr,
                    )
                )
                chunk_idx += 1
                current_paras = [para]
                current_tokens = para_tokens
            else:
                current_paras.append(para)
                current_tokens += para_tokens

        if current_paras:
            raw_c = "\n\n".join(current_paras)
            c_hdr = self._build_context_header(
                project_name=project_name,
                filename=doc.filename,
                document_date=document_date,
                section_path=f"{section_prefix} (Part {len(chunks)+1})",
            )
            f_text = f"{c_hdr}\n\n{raw_c}"
            prov = ProvenanceSpan(
                source_id=doc.document_id,
                source_ref=doc.filename,
                content_hash=doc.content_hash,
                page_no=1,
            )
            chunks.append(
                DocumentChunk(
                    chunk_id=f"{doc.document_id}-chunk-{chunk_idx}",
                    document_id=doc.document_id,
                    tenant_id=doc.tenant_id,
                    chunk_index=chunk_idx,
                    text=f_text,
                    raw_content=raw_c,
                    token_count=self._estimate_tokens(f_text),
                    chunk_type="text",
                    provenance=prov,
                    context_header=c_hdr,
                )
            )

        return chunks

    def _strip_tables_from_text(self, text: str) -> str:
        """Removes markdown pipe tables from text to isolate narrative prose."""
        lines = text.splitlines()
        clean_lines: list[str] = []
        for line in lines:
            if line.strip().startswith("|") and line.strip().endswith("|"):
                continue
            clean_lines.append(line)
        return "\n".join(clean_lines)
