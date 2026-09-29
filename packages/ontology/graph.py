# Owner task: EB-19 Database schema v1
"""Knowledge graph ontology definitions, typed entity taxonomies, and relation constraints.

Defines the core entity and edge vocabulary for the K!larity Enterprise Brain
knowledge graph across architecture, engineering, and construction domains.
"""

from __future__ import annotations

from enum import Enum
from typing import NamedTuple, Optional


class EntityType(str, Enum):
    """Canonical ontology entity types recognized by entity resolution and knowledge graph."""
    PERSON = "Person"
    ORGANISATION = "Organisation"
    CLIENT = "Client"
    VENDOR = "Vendor"
    PROJECT = "Project"
    PHASE = "Phase"
    SITE = "Site"
    DRAWING = "Drawing"
    DOCUMENT = "Document"
    INVOICE = "Invoice"
    CHANGE_ORDER = "ChangeOrder"
    TASK = "Task"
    MEETING = "Meeting"
    PAYMENT = "Payment"
    DECISION = "Decision"


class RelationType(str, Enum):
    """Ontology relation types for temporal knowledge graph edges."""
    WORKS_FOR = "works_for"              # Person -> Organisation
    CONTRACTED_TO = "contracted_to"      # Vendor/Client -> Project/Organisation
    ASSIGNED_TO = "assigned_to"          # Task/Role -> Person/Vendor
    PART_OF = "part_of"                  # Phase -> Project; Subsite -> Site
    APPROVED_BY = "approved_by"          # Decision/ChangeOrder/Drawing -> Person
    PAID_BY = "paid_by"                  # Payment/Invoice -> Organisation/Client
    SUPERSEDES = "supersedes"            # Decision/Drawing/Document -> Decision/Drawing/Document
    REFERENCES = "references"            # Document/Drawing -> Document/Drawing
    LOCATED_AT = "located_at"            # Project/Site -> Site/Location
    PRODUCED = "produced"                # Person/Vendor -> Document/Drawing/ChangeOrder


class RelationRule(NamedTuple):
    """Rule constraining which entity types can be linked by a relation."""
    relation: RelationType
    valid_sources: frozenset[EntityType]
    valid_targets: frozenset[EntityType]


# Canonical validation matrix for knowledge graph relations
RELATION_CONSTRAINTS: dict[RelationType, RelationRule] = {
    RelationType.WORKS_FOR: RelationRule(
        RelationType.WORKS_FOR,
        frozenset({EntityType.PERSON}),
        frozenset({EntityType.ORGANISATION, EntityType.CLIENT, EntityType.VENDOR}),
    ),
    RelationType.CONTRACTED_TO: RelationRule(
        RelationType.CONTRACTED_TO,
        frozenset({EntityType.VENDOR, EntityType.CLIENT, EntityType.ORGANISATION}),
        frozenset({EntityType.PROJECT, EntityType.ORGANISATION}),
    ),
    RelationType.ASSIGNED_TO: RelationRule(
        RelationType.ASSIGNED_TO,
        frozenset({EntityType.TASK}),
        frozenset({EntityType.PERSON, EntityType.VENDOR}),
    ),
    RelationType.PART_OF: RelationRule(
        RelationType.PART_OF,
        frozenset({EntityType.PHASE, EntityType.SITE, EntityType.TASK}),
        frozenset({EntityType.PROJECT, EntityType.SITE}),
    ),
    RelationType.APPROVED_BY: RelationRule(
        RelationType.APPROVED_BY,
        frozenset({EntityType.DECISION, EntityType.CHANGE_ORDER, EntityType.DRAWING, EntityType.INVOICE}),
        frozenset({EntityType.PERSON, EntityType.CLIENT}),
    ),
    RelationType.PAID_BY: RelationRule(
        RelationType.PAID_BY,
        frozenset({EntityType.PAYMENT, EntityType.INVOICE}),
        frozenset({EntityType.CLIENT, EntityType.ORGANISATION}),
    ),
    RelationType.SUPERSEDES: RelationRule(
        RelationType.SUPERSEDES,
        frozenset({EntityType.DECISION, EntityType.DRAWING, EntityType.DOCUMENT, EntityType.CHANGE_ORDER}),
        frozenset({EntityType.DECISION, EntityType.DRAWING, EntityType.DOCUMENT, EntityType.CHANGE_ORDER}),
    ),
    RelationType.REFERENCES: RelationRule(
        RelationType.REFERENCES,
        frozenset({EntityType.DOCUMENT, EntityType.DRAWING, EntityType.DECISION, EntityType.INVOICE}),
        frozenset({EntityType.DOCUMENT, EntityType.DRAWING, EntityType.PROJECT, EntityType.DECISION}),
    ),
    RelationType.LOCATED_AT: RelationRule(
        RelationType.LOCATED_AT,
        frozenset({EntityType.PROJECT, EntityType.SITE}),
        frozenset({EntityType.SITE}),
    ),
    RelationType.PRODUCED: RelationRule(
        RelationType.PRODUCED,
        frozenset({EntityType.PERSON, EntityType.VENDOR, EntityType.ORGANISATION}),
        frozenset({EntityType.DOCUMENT, EntityType.DRAWING, EntityType.CHANGE_ORDER}),
    ),
}


def validate_relation(
    source_type: str | EntityType,
    relation_type: str | RelationType,
    target_type: str | EntityType,
) -> tuple[bool, Optional[str]]:
    """Validate whether an edge connects compatible entity types according to ontology rules.

    Returns:
        (is_valid, error_reason)
    """
    try:
        rel = RelationType(relation_type) if isinstance(relation_type, str) else relation_type
    except ValueError:
        return False, f"Unknown relation type: {relation_type}"

    try:
        src = EntityType(source_type) if isinstance(source_type, str) else source_type
    except ValueError:
        return False, f"Unknown source entity type: {source_type}"

    try:
        tgt = EntityType(target_type) if isinstance(target_type, str) else target_type
    except ValueError:
        return False, f"Unknown target entity type: {target_type}"

    rule = RELATION_CONSTRAINTS.get(rel)
    if not rule:
        return True, None

    if src not in rule.valid_sources:
        allowed = ", ".join(sorted(t.value for t in rule.valid_sources))
        return False, f"{src.value} is not a valid source for {rel.value} (expected: {allowed})"

    if tgt not in rule.valid_targets:
        allowed = ", ".join(sorted(t.value for t in rule.valid_targets))
        return False, f"{tgt.value} is not a valid target for {rel.value} (expected: {allowed})"

    return True, None
