# Owner task: EB-19 Database schema v1
"""SQLAlchemy declarative models for K!larity Enterprise Brain ontology and core tables.

Every table carries tenant_id NOT NULL and composite primary keys / foreign keys
enforcing tenant boundary integrity. All entities and records carry full provenance columns
(source_id, source_ref, ingested_at, content_hash). Temporal edges track valid_from and valid_to.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    mapped_column,
    relationship,
)
from sqlalchemy.types import JSON


class Base(DeclarativeBase):
    """Base class for all K!larity core database models."""
    type_annotation_map = {
        dict[str, Any]: JSONB().with_variant(JSON(), "sqlite"),
    }


class User(Base):
    """Tenant user model (Keycloak mirrored user account)."""
    __tablename__ = "users"
    __table_args__ = (
        Index("idx_users_tenant_id", "tenant_id"),
        Index("idx_users_email", "tenant_id", "email"),
        CheckConstraint("length(tenant_id) >= 2", name="check_users_tenant_id_len"),
        CheckConstraint("length(user_id) >= 1", name="check_users_user_id_len"),
        CheckConstraint("role IN ('owner', 'admin', 'member', 'viewer', 'guest')", name="check_users_role"),
        CheckConstraint("status IN ('active', 'invited', 'suspended', 'deactivated')", name="check_users_status"),
    )

    tenant_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="member")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )


class Project(Base):
    """Client project model."""
    __tablename__ = "projects"
    __table_args__ = (
        Index("idx_projects_tenant_id", "tenant_id"),
        CheckConstraint("length(tenant_id) >= 2", name="check_projects_tenant_id_len"),
        CheckConstraint("length(project_id) >= 1", name="check_projects_project_id_len"),
        CheckConstraint("status IN ('active', 'on_hold', 'completed', 'archived')", name="check_projects_status"),
    )

    tenant_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    code: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    budget: Mapped[Optional[Decimal]] = mapped_column(Numeric(15, 2), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR")
    project_metadata: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    documents: Mapped[list["Document"]] = relationship("Document", back_populates="project")
    events: Mapped[list["Event"]] = relationship("Event", back_populates="project")
    decisions: Mapped[list["Decision"]] = relationship("Decision", back_populates="project")
    finance_txns: Mapped[list["FinanceTxn"]] = relationship("FinanceTxn", back_populates="project")


class SourceRecord(Base):
    """Raw ingested record (raw message, file metadata, webhook body)."""
    __tablename__ = "source_records"
    __table_args__ = (
        Index("idx_source_records_tenant_id", "tenant_id"),
        Index("idx_source_records_source_ref", "tenant_id", "source_id", "source_ref"),
        Index("idx_source_records_hash", "tenant_id", "content_hash"),
        CheckConstraint("length(tenant_id) >= 2", name="check_source_records_tenant_id_len"),
        CheckConstraint("length(record_id) >= 1", name="check_source_records_record_id_len"),
    )

    tenant_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    record_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    source_id: Mapped[str] = mapped_column(String(128), nullable=False)
    source_ref: Mapped[str] = mapped_column(Text, nullable=False)
    source_type: Mapped[str] = mapped_column(String(64), nullable=False)
    raw_uri: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(71), nullable=False)
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )


class Document(Base):
    """Normalized document record."""
    __tablename__ = "documents"
    __table_args__ = (
        Index("idx_documents_tenant_id", "tenant_id"),
        Index("idx_documents_project_id", "tenant_id", "project_id"),
        Index("idx_documents_hash", "tenant_id", "content_hash"),
        CheckConstraint("length(tenant_id) >= 2", name="check_documents_tenant_id_len"),
        CheckConstraint("length(document_id) >= 1", name="check_documents_document_id_len"),
        ForeignKeyConstraint(
            ["tenant_id", "project_id"],
            ["projects.tenant_id", "projects.project_id"],
            ondelete="SET NULL",
        ),
    )

    tenant_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    document_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    doc_type: Mapped[str] = mapped_column(String(64), nullable=False, default="document")
    mime_type: Mapped[str] = mapped_column(String(128), nullable=False, default="application/octet-stream")
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    storage_ref: Mapped[str] = mapped_column(Text, nullable=False)
    source_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    source_ref: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    content_hash: Mapped[str] = mapped_column(String(71), nullable=False)
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    doc_metadata: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    project: Mapped[Optional[Project]] = relationship("Project", back_populates="documents")
    chunks: Mapped[list["Chunk"]] = relationship("Chunk", back_populates="document", cascade="all, delete-orphan")


class Chunk(Base):
    """Textual chunk with embedding reference for hybrid RAG."""
    __tablename__ = "chunks"
    __table_args__ = (
        Index("idx_chunks_tenant_id", "tenant_id"),
        Index("idx_chunks_document_id", "tenant_id", "document_id"),
        CheckConstraint("length(tenant_id) >= 2", name="check_chunks_tenant_id_len"),
        CheckConstraint("length(chunk_id) >= 1", name="check_chunks_chunk_id_len"),
        ForeignKeyConstraint(
            ["tenant_id", "document_id"],
            ["documents.tenant_id", "documents.document_id"],
            ondelete="CASCADE",
        ),
    )

    tenant_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    chunk_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    document_id: Mapped[str] = mapped_column(String(64), nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    text_content: Mapped[str] = mapped_column(Text, nullable=False)
    token_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    embedding_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    source_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    source_ref: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    content_hash: Mapped[str] = mapped_column(String(71), nullable=False)
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    chunk_metadata: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    document: Mapped[Document] = relationship("Document", back_populates="chunks")


class Entity(Base):
    """Canonical ontology entity (node in the knowledge graph)."""
    __tablename__ = "entities"
    __table_args__ = (
        Index("idx_entities_tenant_id", "tenant_id"),
        Index("idx_entities_type", "tenant_id", "entity_type"),
        Index("idx_entities_canonical", "tenant_id", "canonical_name"),
        CheckConstraint("length(tenant_id) >= 2", name="check_entities_tenant_id_len"),
        CheckConstraint("length(entity_id) >= 1", name="check_entities_entity_id_len"),
        CheckConstraint("status IN ('active', 'merged', 'deprecated')", name="check_entities_status"),
    )

    tenant_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    entity_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    canonical_name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    source_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    source_ref: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    content_hash: Mapped[Optional[str]] = mapped_column(String(71), nullable=True)
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    attributes: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    aliases: Mapped[list["Alias"]] = relationship("Alias", back_populates="entity", cascade="all, delete-orphan")
    outgoing_edges: Mapped[list["Edge"]] = relationship(
        "Edge",
        foreign_keys="[Edge.tenant_id, Edge.source_entity_id]",
        back_populates="source_entity",
        overlaps="incoming_edges,target_entity",
    )
    incoming_edges: Mapped[list["Edge"]] = relationship(
        "Edge",
        foreign_keys="[Edge.tenant_id, Edge.target_entity_id]",
        back_populates="target_entity",
        overlaps="outgoing_edges,source_entity",
    )


class Alias(Base):
    """Surface form / alias for entity resolution."""
    __tablename__ = "aliases"
    __table_args__ = (
        Index("idx_aliases_tenant_id", "tenant_id"),
        Index("idx_aliases_name", "tenant_id", "alias_name"),
        Index("idx_aliases_entity", "tenant_id", "entity_id"),
        CheckConstraint("length(tenant_id) >= 2", name="check_aliases_tenant_id_len"),
        CheckConstraint("length(alias_id) >= 1", name="check_aliases_alias_id_len"),
        ForeignKeyConstraint(
            ["tenant_id", "entity_id"],
            ["entities.tenant_id", "entities.entity_id"],
            ondelete="CASCADE",
        ),
    )

    tenant_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    alias_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    entity_id: Mapped[str] = mapped_column(String(64), nullable=False)
    alias_name: Mapped[str] = mapped_column(String(255), nullable=False)
    confidence: Mapped[Decimal] = mapped_column(Numeric(5, 4), nullable=False, default=Decimal("1.0000"))
    source_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    source_ref: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    entity: Mapped[Entity] = relationship("Entity", back_populates="aliases")


class Edge(Base):
    """Temporal edge connecting two entities in the knowledge graph."""
    __tablename__ = "edges"
    __table_args__ = (
        Index("idx_edges_tenant_id", "tenant_id"),
        Index("idx_edges_source", "tenant_id", "source_entity_id"),
        Index("idx_edges_target", "tenant_id", "target_entity_id"),
        Index("idx_edges_temporal", "tenant_id", "valid_from", "valid_to"),
        Index("idx_edges_relation", "tenant_id", "relation_type"),
        CheckConstraint("length(tenant_id) >= 2", name="check_edges_tenant_id_len"),
        CheckConstraint("length(edge_id) >= 1", name="check_edges_edge_id_len"),
        CheckConstraint("valid_to IS NULL OR valid_to >= valid_from", name="check_edges_valid_window"),
        ForeignKeyConstraint(
            ["tenant_id", "source_entity_id"],
            ["entities.tenant_id", "entities.entity_id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "target_entity_id"],
            ["entities.tenant_id", "entities.entity_id"],
            ondelete="CASCADE",
        ),
    )

    tenant_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    edge_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    source_entity_id: Mapped[str] = mapped_column(String(64), nullable=False)
    target_entity_id: Mapped[str] = mapped_column(String(64), nullable=False)
    relation_type: Mapped[str] = mapped_column(String(64), nullable=False)
    valid_from: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    valid_to: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, default=None)
    confidence: Mapped[Decimal] = mapped_column(Numeric(5, 4), nullable=False, default=Decimal("1.0000"))
    source_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    source_ref: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    content_hash: Mapped[Optional[str]] = mapped_column(String(71), nullable=True)
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    properties: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    source_entity: Mapped[Entity] = relationship(
        "Entity",
        foreign_keys=[tenant_id, source_entity_id],
        back_populates="outgoing_edges",
        overlaps="incoming_edges,target_entity",
    )
    target_entity: Mapped[Entity] = relationship(
        "Entity",
        foreign_keys=[tenant_id, target_entity_id],
        back_populates="incoming_edges",
        overlaps="outgoing_edges,source_entity",
    )

    def is_current(self, as_of: Optional[datetime] = None) -> bool:
        """Check whether the edge was valid at a specific point in time."""
        t = as_of or datetime.now(timezone.utc)
        if self.valid_from > t:
            return False
        if self.valid_to is not None and self.valid_to < t:
            return False
        return True


class Event(Base):
    """Chronological domain event (site issue, payment made, approval, milestone)."""
    __tablename__ = "events"
    __table_args__ = (
        Index("idx_events_tenant_id", "tenant_id"),
        Index("idx_events_occurred_at", "tenant_id", "occurred_at"),
        Index("idx_events_type", "tenant_id", "event_type"),
        CheckConstraint("length(tenant_id) >= 2", name="check_events_tenant_id_len"),
        CheckConstraint("length(event_id) >= 1", name="check_events_event_id_len"),
        ForeignKeyConstraint(
            ["tenant_id", "project_id"],
            ["projects.tenant_id", "projects.project_id"],
            ondelete="SET NULL",
        ),
    )

    tenant_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    event_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    project_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    confidence: Mapped[Decimal] = mapped_column(Numeric(5, 4), nullable=False, default=Decimal("1.0000"))
    source_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    source_ref: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    content_hash: Mapped[Optional[str]] = mapped_column(String(71), nullable=True)
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    project: Mapped[Optional[Project]] = relationship("Project", back_populates="events")


class Decision(Base):
    """Decision Memory: logged decisions with rationale and status tracking."""
    __tablename__ = "decisions"
    __table_args__ = (
        Index("idx_decisions_tenant_id", "tenant_id"),
        Index("idx_decisions_project", "tenant_id", "project_id"),
        Index("idx_decisions_status", "tenant_id", "status"),
        CheckConstraint("length(tenant_id) >= 2", name="check_decisions_tenant_id_len"),
        CheckConstraint("length(decision_id) >= 1", name="check_decisions_decision_id_len"),
        CheckConstraint(
            "status IN ('proposed', 'decided', 'superseded', 'revoked')", name="check_decisions_status"
        ),
        ForeignKeyConstraint(
            ["tenant_id", "project_id"],
            ["projects.tenant_id", "projects.project_id"],
            ondelete="SET NULL",
        ),
    )

    tenant_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    decision_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    rationale: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="decided")
    decided_by: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    decided_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    superseded_by: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    source_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    source_ref: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    content_hash: Mapped[Optional[str]] = mapped_column(String(71), nullable=True)
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    decision_metadata: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    project: Mapped[Optional[Project]] = relationship("Project", back_populates="decisions")


class FinanceTxn(Base):
    """Financial transaction (invoice, payment, change order, note)."""
    __tablename__ = "finance_txns"
    __table_args__ = (
        Index("idx_finance_txns_tenant_id", "tenant_id"),
        Index("idx_finance_txns_project", "tenant_id", "project_id"),
        Index("idx_finance_txns_date", "tenant_id", "txn_date"),
        CheckConstraint("length(tenant_id) >= 2", name="check_finance_txns_tenant_id_len"),
        CheckConstraint("length(txn_id) >= 1", name="check_finance_txns_txn_id_len"),
        CheckConstraint(
            "txn_type IN ('invoice', 'payment', 'credit_note', 'debit_note', 'change_order')",
            name="check_finance_txns_type",
        ),
        CheckConstraint(
            "status IN ('pending', 'completed', 'overdue', 'cancelled', 'disputed')",
            name="check_finance_txns_status",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "project_id"],
            ["projects.tenant_id", "projects.project_id"],
            ondelete="SET NULL",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "counterparty_entity_id"],
            ["entities.tenant_id", "entities.entity_id"],
            ondelete="SET NULL",
        ),
    )

    tenant_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    txn_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    txn_type: Mapped[str] = mapped_column(String(32), nullable=False)
    txn_ref: Mapped[str] = mapped_column(String(128), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="completed")
    counterparty_entity_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    txn_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    source_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    source_ref: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    content_hash: Mapped[Optional[str]] = mapped_column(String(71), nullable=True)
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    txn_metadata: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    project: Mapped[Optional[Project]] = relationship("Project", back_populates="finance_txns")
