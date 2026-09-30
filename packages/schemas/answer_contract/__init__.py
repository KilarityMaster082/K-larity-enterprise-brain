# Owner task: EB-47 Reasoning and answer contract
"""Answer contract schema package."""

from packages.schemas.answer_contract.schema import (
    AnswerContract,
    AnswerStatus,
    Claim,
    Confidence,
    ConfidenceLevel,
    Evidence,
    EvidenceBBox,
    EvidenceLocator,
    EvidenceSpan,
    EvidenceTableRef,
    Figure,
    SCHEMA_VERSION,
    Risk,
    Segment,
    SourceType,
    SuggestedAction,
)

__all__ = [
    "AnswerContract",
    "AnswerStatus",
    "Claim",
    "Confidence",
    "ConfidenceLevel",
    "Evidence",
    "EvidenceBBox",
    "EvidenceLocator",
    "EvidenceSpan",
    "EvidenceTableRef",
    "SCHEMA_VERSION",
    "Figure",
    "Risk",
    "Segment",
    "SourceType",
    "SuggestedAction",
]
