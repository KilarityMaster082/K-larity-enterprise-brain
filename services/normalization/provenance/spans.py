# Owner task: EB-30 Document parsing (Docling / Tika) and contextual chunking
"""Provenance spans and bounding box representations for document chunks and extractions.

Preserves exact visual and cryptographic provenance (page numbers, bounding boxes,
content hashes, and temporal validity) as required by Rule 1 and Rule 3.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(frozen=True)
class BoundingBox:
    """Rectangular bounding box on a document page.

    Coordinates are normalized between 0.0 and 1.0 (or 0 and 1000 scale)
    relative to page width and height:
    - page: 1-indexed page number
    - x0: left edge
    - y0: top edge
    - x1: right edge
    - y1: bottom edge
    """

    page: int
    x0: float
    y0: float
    x1: float
    y1: float

    def __post_init__(self) -> None:
        if self.page < 1:
            raise ValueError(f"page must be >= 1, got {self.page}")
        if self.x1 < self.x0:
            raise ValueError(f"x1 ({self.x1}) must be >= x0 ({self.x0})")
        if self.y1 < self.y0:
            raise ValueError(f"y1 ({self.y1}) must be >= y0 ({self.y0})")

    @property
    def width(self) -> float:
        return self.x1 - self.x0

    @property
    def height(self) -> float:
        return self.y1 - self.y0

    @property
    def area(self) -> float:
        return self.width * self.height

    def intersects(self, other: BoundingBox) -> bool:
        """Checks if two bounding boxes on the same page overlap."""
        if self.page != other.page:
            return False
        return not (
            self.x1 < other.x0
            or self.x0 > other.x1
            or self.y1 < other.y0
            or self.y0 > other.y1
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> BoundingBox:
        return cls(
            page=int(d["page"]),
            x0=float(d["x0"]),
            y0=float(d["y0"]),
            x1=float(d["x1"]),
            y1=float(d["y1"]),
        )


@dataclass(frozen=True)
class ProvenanceSpan:
    """Cryptographic and spatial provenance for any extracted passage, table or fact.

    Retains the source document ID, filename or URI, content hash, page number,
    optional bounding box, character offsets, and temporal validity range.
    """

    source_id: str
    source_ref: str
    content_hash: str
    page_no: int | None = None
    bbox: BoundingBox | None = None
    char_start: int | None = None
    char_end: int | None = None
    temporal_valid_from: str | None = None
    temporal_valid_to: str | None = None
    extra_metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        if self.bbox is not None:
            data["bbox"] = self.bbox.to_dict()
        return data

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> ProvenanceSpan:
        bbox_data = d.get("bbox")
        bbox = BoundingBox.from_dict(bbox_data) if bbox_data else None
        return cls(
            source_id=d["source_id"],
            source_ref=d["source_ref"],
            content_hash=d["content_hash"],
            page_no=d.get("page_no"),
            bbox=bbox,
            char_start=d.get("char_start"),
            char_end=d.get("char_end"),
            temporal_valid_from=d.get("temporal_valid_from"),
            temporal_valid_to=d.get("temporal_valid_to"),
            extra_metadata=d.get("extra_metadata", {}),
        )
