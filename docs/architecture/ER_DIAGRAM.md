# Database Entity-Relationship Diagram (Schema v1)

> Owner task: EB-19 Database schema v1  
> Deliverables: db/migrations/0001_initial.sql, db/migrations/0001_initial.down.sql, packages/ontology/models.py, packages/ontology/graph.py  
> Multi-tenancy: Logical isolation via PostgreSQL Row-Level Security (`FORCE RLS`) with `current_setting('app.tenant_id', true)` and compound foreign keys containing `tenant_id`.

---

## 1. Visual Entity-Relationship Diagram

```mermaid
erDiagram
    users ||--o{ projects : manages
    projects ||--o{ documents : contains
    projects ||--o{ events : logs
    projects ||--o{ decisions : records
    projects ||--o{ finance_txns : tracks
    documents ||--|{ chunks : split_into
    source_records ||--o{ documents : raw_origin
    entities ||--o{ aliases : resolved_from
    entities ||--o{ edges : outgoing
    entities ||--o{ edges : incoming
    entities ||--o{ finance_txns : counterparty

    users {
        string tenant_id PK
        string user_id PK
        string email
        string full_name
        string role
        string status
        timestamp created_at
        timestamp updated_at
    }

    projects {
        string tenant_id PK
        string project_id PK
        string name
        string code
        string description
        string status
        numeric budget
        string currency
        jsonb metadata
        timestamp created_at
        timestamp updated_at
    }

    source_records {
        string tenant_id PK
        string record_id PK
        string source_id
        string source_ref
        string source_type
        string raw_uri
        string content_hash
        timestamp ingested_at
        jsonb payload
        timestamp created_at
    }

    documents {
        string tenant_id PK
        string document_id PK
        string project_id FK
        string title
        string doc_type
        string mime_type
        bigint size_bytes
        string storage_ref
        string source_id
        string source_ref
        string content_hash
        timestamp ingested_at
        jsonb metadata
        timestamp created_at
        timestamp updated_at
    }

    chunks {
        string tenant_id PK
        string chunk_id PK
        string document_id FK
        integer chunk_index
        text text_content
        integer token_count
        string embedding_id
        string source_id
        string source_ref
        string content_hash
        timestamp ingested_at
        jsonb metadata
        timestamp created_at
    }

    entities {
        string tenant_id PK
        string entity_id PK
        string entity_type
        string canonical_name
        string description
        string status
        string source_id
        string source_ref
        string content_hash
        timestamp ingested_at
        jsonb attributes
        timestamp created_at
        timestamp updated_at
    }

    aliases {
        string tenant_id PK
        string alias_id PK
        string entity_id FK
        string alias_name
        numeric confidence
        string source_id
        string source_ref
        timestamp ingested_at
        timestamp created_at
    }

    edges {
        string tenant_id PK
        string edge_id PK
        string source_entity_id FK
        string target_entity_id FK
        string relation_type
        timestamp valid_from
        timestamp valid_to
        numeric confidence
        string source_id
        string source_ref
        string content_hash
        timestamp ingested_at
        jsonb properties
        timestamp created_at
    }

    events {
        string tenant_id PK
        string event_id PK
        string event_type
        string project_id FK
        timestamp occurred_at
        string title
        string description
        numeric confidence
        string source_id
        string source_ref
        string content_hash
        timestamp ingested_at
        jsonb payload
        timestamp created_at
    }

    decisions {
        string tenant_id PK
        string decision_id PK
        string project_id FK
        string title
        string description
        string rationale
        string status
        string decided_by
        timestamp decided_at
        string superseded_by
        string source_id
        string source_ref
        string content_hash
        timestamp ingested_at
        jsonb metadata
        timestamp created_at
        timestamp updated_at
    }

    finance_txns {
        string tenant_id PK
        string txn_id PK
        string project_id FK
        string txn_type
        string txn_ref
        numeric amount
        string currency
        string status
        string counterparty_entity_id FK
        date txn_date
        date due_date
        string source_id
        string source_ref
        string content_hash
        timestamp ingested_at
        jsonb metadata
        timestamp created_at
        timestamp updated_at
    }
```

---

## 2. Structural Principles

### 2.1 Tenant Isolation at the Physical and Logical Level (Risk R-6)
- **Every table has `tenant_id NOT NULL`** with a format check constraint (`CHECK (tenant_id ~ '^[a-z0-9][a-z0-9-]{1,62}$')`).
- **Every table has an explicit index on `tenant_id`** (`idx_<table_name>_tenant_id`).
- **Composite Primary Keys**: Every primary key is compound `(tenant_id, <entity_id>)`, guaranteeing uniqueness per tenant.
- **Composite Foreign Keys**: All inter-table relations require matching `tenant_id` pairs (e.g. `(tenant_id, project_id) REFERENCES projects (tenant_id, project_id)`). This guarantees cross-tenant references cannot exist at the database engine level.
- **Postgres Row-Level Security**: Every table has `ENABLE ROW LEVEL SECURITY;` and `FORCE ROW LEVEL SECURITY;`, with a policy evaluating `tenant_id = current_setting('app.tenant_id', true)`.

### 2.2 Complete Provenance Tracking (Subtask 3)
Across `source_records`, `documents`, `chunks`, `entities`, `aliases`, `edges`, `events`, `decisions`, and `finance_txns`, every row captures:
1. `source_id`: The connector or integration source identifier (e.g., `whatsapp-main`, `drive-inbox`, `gmail-finance`).
2. `source_ref`: The external system identifier or URI (message ID, file URI, email thread ID).
3. `ingested_at`: High-precision timestamp when the information entered K!larity.
4. `content_hash`: Cryptographic content hash (`sha256:...`) ensuring byte-level verification and deduplication.

### 2.3 Temporal Knowledge Graph (Subtask 2)
In the `edges` table:
- `valid_from`: Timestamp when the relationship became true in the real world (defaults to `now()`).
- `valid_to`: Timestamp when the relationship expired or was superseded (`NULL` means currently valid).
- Constraint: `CHECK (valid_to IS NULL OR valid_to >= valid_from)`.
- Index: `idx_edges_temporal ON edges (tenant_id, valid_from, valid_to)` for high-speed point-in-time and historical graph queries.

### 2.4 Decision Memory & Finance
- `decisions`: Stores architectural, construction, design, and commercial decisions with structured status transitions (`proposed` -> `decided` -> `superseded` / `revoked`) and exact rationale.
- `finance_txns`: Stores invoices, payments, credit notes, and change orders with exact Decimal amounts (`numeric(15,2)`), counterparty entity links, and provenance citations.
