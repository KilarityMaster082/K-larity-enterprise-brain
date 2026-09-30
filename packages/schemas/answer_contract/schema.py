# Owner task: EB-47 Reasoning and answer contract
"""Canonical Pydantic schema for the Enterprise Brain Answer Contract.

Enforces:
- Rule 4: Citations required on every answer. Every fact must reference an evidence ID.
- Rule 3: Figures and monetary amounts only ever come from SQL tools, never hallucinated by model.
- Compatibility with Ask Brain UI (apps/web/lib/contracts.ts).
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
import json
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class SourceType(str, Enum):
    EMAIL = "email"
    WHATSAPP = "whatsapp"
    SHEET = "sheet"
    DOCUMENT = "document"
    DRAWING = "drawing"
    MEETING = "meeting"
    LEDGER = "ledger"
    SQL = "sql"


class ConfidenceLevel(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class AnswerStatus(str, Enum):
    ANSWERED = "answered"
    PARTIAL = "partial"
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"
    NO_ACCESS = "no_access"


class EvidenceSpan(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    start: int = Field(ge=0, description="Character offset start in excerpt")
    end: int = Field(ge=0, description="Character offset end in excerpt")

    @model_validator(mode="after")
    def validate_range(self) -> EvidenceSpan:
        if self.end < self.start:
            raise ValueError(f"Span end ({self.end}) cannot be before start ({self.start})")
        return self


class Evidence(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(..., description="Unique evidence ID (e.g. ev_chk_123 or ev_sql_456)")
    source_type: SourceType = Field(..., alias="sourceType")
    title: str = Field(..., description="Document, email subject, or record title")
    author: str | None = Field(default=None, description="Sender, author, or creator")
    occurred_at: str | None = Field(default=None, alias="occurredAt", description="ISO 8601 timestamp")
    project: str | None = Field(default=None, description="Associated project code or name")
    excerpt: str = Field(..., description="Exact context snippet supporting the claim")
    highlight: EvidenceSpan | None = Field(default=None, description="Precise bounding span within excerpt")
    open_url: str | None = Field(default=None, alias="openUrl", description="Deep link to source")


class Figure(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    amount: float = Field(..., description="Numeric value or monetary amount")
    currency: Literal["INR", "USD"] = Field(default="INR", description="Currency symbol")
    origin: Literal["sql"] = Field(default="sql", description="Numbers only ever come from SQL, never from model")
    query: str | None = Field(default=None, description="Named, reviewed query or hash producing the figure")


class Segment(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    text: str = Field(..., description="Sentence or paragraph text")
    evidence_ids: list[str] = Field(default_factory=list, alias="evidenceIds")


class Claim(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(..., description="Unique claim identifier (e.g. fact_1)")
    text: str = Field(..., description="Atomic factual assertion")
    evidence_ids: list[str] = Field(..., min_length=1, alias="evidenceIds", description="Referenced evidence IDs")
    figure: Figure | None = Field(default=None, description="Associated audited numeric figure")


class Risk(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(..., description="Unique risk identifier (e.g. risk_1)")
    text: str = Field(..., description="Risk assertion")
    evidence_ids: list[str] = Field(default_factory=list, alias="evidenceIds")
    severity: Literal["high", "medium", "low"] = Field(default="medium")
    figure: Figure | None = None


class SuggestedAction(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(..., description="Action identifier")
    label: str = Field(..., description="Human-readable button or task label")
    kind: Literal["draft_message", "create_task", "open_source"] = Field(
        ..., description="Action type"
    )
    requires_approval: bool = Field(
        default=True, alias="requiresApproval", description="CLAUDE.md rule 10: side-effects require approval"
    )
    draft: dict[str, Any] | None = Field(
        default=None, description="Draft payload for human-in-the-loop review"
    )


class Confidence(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    level: ConfidenceLevel
    reason: str


class AnswerContract(BaseModel):
    """The canonical Answer Contract delivered by the Reasoning step (EB-47)."""

    model_config = ConfigDict(populate_by_name=True)

    version: str = Field(default="1.0.0", description="Contract schema version")
    question: str = Field(..., description="Original user prompt or normalized query")
    status: AnswerStatus = Field(..., description="Outcome status of the reasoning step")
    summary: str = Field(default="", description="High-level executive summary")
    answer: list[Segment] = Field(..., description="Structured sentences with inline evidence citation chips")
    facts: list[Claim] = Field(default_factory=list, description="Extracted atomic factual claims")
    causes: list[Claim] = Field(default_factory=list, description="Causal factors identified")
    risks: list[Risk] = Field(default_factory=list, description="Risks identified from evidence")
    unknowns: list[str] = Field(default_factory=list, description="Gaps, missing data, or unanswered parts")
    conflicts: list[str] = Field(default_factory=list, description="Conflicting evidence discovered across sources")
    confidence: Confidence = Field(..., description="Self-assessed confidence level and justification")
    actions: list[SuggestedAction] = Field(default_factory=list, description="Actionable recommendations")
    evidence: list[Evidence] = Field(default_factory=list, description="All cited evidence context passages")
    generated_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        alias="generatedAt",
        description="ISO 8601 generation timestamp",
    )

    @model_validator(mode="after")
    def validate_citations_and_evidence(self) -> AnswerContract:
        """Enforces: 100% of facts reference an evidence ID; every referenced evidence ID exists in evidence list."""
        known_evidence_ids = {ev.id for ev in self.evidence}

        # If answered successfully, facts must exist and each must have valid evidence
        if self.status == AnswerStatus.ANSWERED and not self.facts:
            raise ValueError("An 'answered' status requires at least one factual claim in facts")

        # Validate facts
        for fact in self.facts:
            if not fact.evidence_ids:
                raise ValueError(f"Fact '{fact.id}' has no evidence IDs; all facts must cite evidence")
            for eid in fact.evidence_ids:
                if eid not in known_evidence_ids:
                    raise ValueError(
                        f"Fact '{fact.id}' references unknown evidence ID '{eid}' not present in evidence list"
                    )

        # Validate inline answer segments
        for seg in self.answer:
            for eid in seg.evidence_ids:
                if eid not in known_evidence_ids:
                    raise ValueError(
                        f"Answer segment references unknown evidence ID '{eid}' not present in evidence list"
                    )

        # Validate risks
        for r in self.risks:
            for eid in r.evidence_ids:
                if eid not in known_evidence_ids:
                    raise ValueError(
                        f"Risk '{r.id}' references unknown evidence ID '{eid}' not present in evidence list"
                    )

        return self

    @classmethod
    def export_json_schema(cls, indent: int = 2) -> str:
        """Exports JSON Schema representation of the contract."""
        return json.dumps(cls.model_json_schema(), indent=indent)
