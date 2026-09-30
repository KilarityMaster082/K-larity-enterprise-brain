# Owner task: EB-30 Document parsing (Docling / Tika) and contextual chunking
"""Document normalization, multi-format parsing, OCR, and structure-aware chunking."""

from services.normalization.chunking.message_window import ChatMessage, MessageWindowChunker
from services.normalization.chunking.structural import StructureAwareChunker
from services.normalization.models import DocumentChunk, ParsedDocument, ParsedTable
from services.normalization.parsers.docling_parser import DoclingParser
from services.normalization.parsers.ocr import OCRParser
from services.normalization.parsers.tika_parser import TikaParser
from services.normalization.provenance.spans import BoundingBox, ProvenanceSpan

__all__ = [
    "BoundingBox",
    "ChatMessage",
    "DoclingParser",
    "DocumentChunk",
    "MessageWindowChunker",
    "OCRParser",
    "ParsedDocument",
    "ParsedTable",
    "ProvenanceSpan",
    "StructureAwareChunker",
    "TikaParser",
]
