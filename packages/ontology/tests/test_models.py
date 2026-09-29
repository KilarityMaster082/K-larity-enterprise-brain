# Owner task: EB-19 Database schema v1
"""Tests for SQLAlchemy ontology declarative models and relation constraints."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from packages.ontology.graph import (
    EntityType,
    RelationType,
    validate_relation,
)
from packages.ontology.models import (
    Alias,
    Base,
    Chunk,
    Decision,
    Document,
    Edge,
    Entity,
    Event,
    FinanceTxn,
    Project,
    SourceRecord,
    User,
)


@pytest.fixture
def session() -> Session:
    """Provides an in-memory SQLite session with all tables created."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as sess:
        yield sess


def test_create_and_query_core_tables(session: Session) -> None:
    """Test creating records across all core tables and verifying tenant isolation."""
    tenant_id = "tenant-test-01"
    now = datetime.now(timezone.utc)

    # 1. User
    user = User(
        tenant_id=tenant_id,
        user_id="user-01",
        email="architect@example.com",
        full_name="Chief Architect",
        role="admin",
        status="active",
    )
    session.add(user)

    # 2. Project
    project = Project(
        tenant_id=tenant_id,
        project_id="proj-hyd-tower",
        name="Hyderabad Tower A",
        code="HYD-A",
        description="High-rise commercial project",
        budget=Decimal("50000000.00"),
        currency="INR",
        project_metadata={"site": "Gachibowli", "floors": 42},
    )
    session.add(project)

    # 3. Source Record
    record = SourceRecord(
        tenant_id=tenant_id,
        record_id="rec-001",
        source_id="whatsapp-site",
        source_ref="msg-987654",
        source_type="whatsapp",
        raw_uri="s3://klarity-tenant-test-01/raw/rec-001.json",
        content_hash="sha256:" + "a" * 64,
        payload={"text": "Pouring slab 4 today"},
    )
    session.add(record)

    # 4. Document & Chunks
    doc = Document(
        tenant_id=tenant_id,
        document_id="doc-struct-01",
        project_id="proj-hyd-tower",
        title="Structural Foundation Drawing Rev 2",
        doc_type="drawing",
        mime_type="application/pdf",
        size_bytes=1048576,
        storage_ref="docs/proj-hyd-tower/doc-struct-01.pdf",
        source_id="drive-sync",
        source_ref="gdrive://file-12345",
        content_hash="sha256:" + "b" * 64,
        doc_metadata={"revision": 2, "scale": "1:100"},
    )
    session.add(doc)

    chunk = Chunk(
        tenant_id=tenant_id,
        chunk_id="chunk-001",
        document_id="doc-struct-01",
        chunk_index=0,
        text_content="Foundation grade M40 concrete required for pile caps.",
        token_count=10,
        source_id="drive-sync",
        source_ref="gdrive://file-12345#page=1",
        content_hash="sha256:" + "c" * 64,
        chunk_metadata={"page": 1},
    )
    session.add(chunk)

    # 5. Entities, Aliases & Edges
    vendor_ent = Entity(
        tenant_id=tenant_id,
        entity_id="ent-vendor-larsen",
        entity_type=EntityType.VENDOR.value,
        canonical_name="Larsen & Toubro",
        description="General Contractor",
        source_id="drive-sync",
        source_ref="contract-001",
        content_hash="sha256:" + "d" * 64,
        attributes={"tier": 1},
    )
    person_ent = Entity(
        tenant_id=tenant_id,
        entity_id="ent-person-rajesh",
        entity_type=EntityType.PERSON.value,
        canonical_name="Rajesh Sharma",
        description="Project Manager at L&T",
        source_id="whatsapp-site",
        source_ref="msg-987654",
        content_hash="sha256:" + "e" * 64,
        attributes={"phone": "+919876543210"},
    )
    session.add_all([vendor_ent, person_ent])

    alias = Alias(
        tenant_id=tenant_id,
        alias_id="alias-01",
        entity_id="ent-vendor-larsen",
        alias_name="L&T Construction",
        confidence=Decimal("0.9800"),
    )
    session.add(alias)

    edge = Edge(
        tenant_id=tenant_id,
        edge_id="edge-01",
        source_entity_id="ent-person-rajesh",
        target_entity_id="ent-vendor-larsen",
        relation_type=RelationType.WORKS_FOR.value,
        valid_from=now - timedelta(days=30),
        valid_to=None,
        confidence=Decimal("1.0000"),
        source_id="contract-001",
        source_ref="employment-doc",
    )
    session.add(edge)

    # 6. Events
    event = Event(
        tenant_id=tenant_id,
        event_id="evt-001",
        event_type="site_issue",
        project_id="proj-hyd-tower",
        occurred_at=now,
        title="Concrete slump test failed batch 4",
        description="Slump test recorded 180mm vs 120mm specified.",
        confidence=Decimal("0.9500"),
        source_id="whatsapp-site",
        source_ref="msg-987655",
        content_hash="sha256:" + "f" * 64,
        payload={"batch": 4, "retest": True},
    )
    session.add(event)

    # 7. Decisions
    decision = Decision(
        tenant_id=tenant_id,
        decision_id="dec-001",
        project_id="proj-hyd-tower",
        title="Approve redesigned column reinforcement",
        description="Increased rebar diameter from 25mm to 32mm at grid C4.",
        rationale="Structural engineer calculation update following revised soil report.",
        status="decided",
        decided_by="user-01",
        decided_at=now,
        source_id="email-thread",
        source_ref="msg-rfc-324",
        content_hash="sha256:" + "1" * 64,
        decision_metadata={"cost_impact_inr": 250000},
    )
    session.add(decision)

    # 8. Finance Transactions
    txn = FinanceTxn(
        tenant_id=tenant_id,
        txn_id="txn-inv-001",
        project_id="proj-hyd-tower",
        txn_type="invoice",
        txn_ref="INV-2026-089",
        amount=Decimal("1250000.00"),
        currency="INR",
        status="completed",
        counterparty_entity_id="ent-vendor-larsen",
        txn_date=date(2026, 9, 28),
        due_date=date(2026, 10, 28),
        source_id="accounting-export",
        source_ref="tally://voucher/8912",
        content_hash="sha256:" + "2" * 64,
        txn_metadata={"gst_rate": 18},
    )
    session.add(txn)

    session.commit()

    # Query and assert persistence
    stored_user = session.get(User, (tenant_id, "user-01"))
    assert stored_user is not None
    assert stored_user.email == "architect@example.com"

    stored_proj = session.get(Project, (tenant_id, "proj-hyd-tower"))
    assert stored_proj is not None
    assert stored_proj.budget == Decimal("50000000.00")
    assert len(stored_proj.documents) == 1
    assert len(stored_proj.events) == 1
    assert len(stored_proj.decisions) == 1
    assert len(stored_proj.finance_txns) == 1

    stored_doc = session.get(Document, (tenant_id, "doc-struct-01"))
    assert stored_doc is not None
    assert len(stored_doc.chunks) == 1
    assert stored_doc.chunks[0].token_count == 10

    stored_ent = session.get(Entity, (tenant_id, "ent-vendor-larsen"))
    assert stored_ent is not None
    assert len(stored_ent.aliases) == 1
    assert stored_ent.aliases[0].alias_name == "L&T Construction"


def test_edge_temporal_validity() -> None:
    """Test valid_from and valid_to temporal window logic on Edge."""
    now = datetime.now(timezone.utc)
    t_past = now - timedelta(days=10)
    t_future = now + timedelta(days=10)

    # Active edge (currently valid)
    current_edge = Edge(
        tenant_id="t1",
        edge_id="e1",
        source_entity_id="ent-1",
        target_entity_id="ent-2",
        relation_type="works_for",
        valid_from=t_past,
        valid_to=None,
    )
    assert current_edge.is_current(now) is True

    # Expired edge
    expired_edge = Edge(
        tenant_id="t1",
        edge_id="e2",
        source_entity_id="ent-1",
        target_entity_id="ent-2",
        relation_type="works_for",
        valid_from=t_past,
        valid_to=now - timedelta(days=2),
    )
    assert expired_edge.is_current(now) is False

    # Future edge (not yet valid)
    future_edge = Edge(
        tenant_id="t1",
        edge_id="e3",
        source_entity_id="ent-1",
        target_entity_id="ent-2",
        relation_type="works_for",
        valid_from=t_future,
        valid_to=None,
    )
    assert future_edge.is_current(now) is False


def test_ontology_relation_validation() -> None:
    """Test graph ontology validation constraints."""
    # Valid: Person works_for Organisation
    valid, err = validate_relation(EntityType.PERSON, RelationType.WORKS_FOR, EntityType.ORGANISATION)
    assert valid is True
    assert err is None

    # Valid: Vendor contracted_to Project
    valid, err = validate_relation(EntityType.VENDOR, RelationType.CONTRACTED_TO, EntityType.PROJECT)
    assert valid is True
    assert err is None

    # Invalid: Drawing works_for Person
    valid, err = validate_relation(EntityType.DRAWING, RelationType.WORKS_FOR, EntityType.PERSON)
    assert valid is False
    assert err is not None
    assert "Drawing is not a valid source" in err

    # Invalid: Unknown relation
    valid, err = validate_relation(EntityType.PERSON, "invented_relation", EntityType.PROJECT)
    assert valid is False
    assert "Unknown relation type" in err
