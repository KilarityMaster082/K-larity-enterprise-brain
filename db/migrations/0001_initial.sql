-- Owner task: EB-19 Database schema v1
-- Core database schema v1: tenants, users, projects, source_records, documents,
-- chunks, entities, aliases, edges (temporal), events, decisions, finance_txns.
-- Multi-tenant isolation (Risk R-6): every table carries tenant_id NOT NULL,
-- has an explicit index on tenant_id, uses composite foreign keys scoped to tenant_id,
-- and enforces Postgres Row-Level Security (FORCE RLS).

-- 1. Users
CREATE TABLE IF NOT EXISTS users (
    tenant_id              text        NOT NULL CHECK (tenant_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    user_id                text        NOT NULL CHECK (user_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    email                  text        NOT NULL,
    full_name              text        NOT NULL,
    role                   text        NOT NULL DEFAULT 'member'
                           CHECK (role IN ('owner', 'admin', 'member', 'viewer', 'guest')),
    status                 text        NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'invited', 'suspended', 'deactivated')),
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users (tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (tenant_id, email);

-- 2. Projects
CREATE TABLE IF NOT EXISTS projects (
    tenant_id              text        NOT NULL CHECK (tenant_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    project_id             text        NOT NULL CHECK (project_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    name                   text        NOT NULL,
    code                   text,
    description            text,
    status                 text        NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'on_hold', 'completed', 'archived')),
    budget                 numeric(15,2),
    currency               text        NOT NULL DEFAULT 'INR',
    metadata               jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_projects_tenant_id ON projects (tenant_id);

-- 3. Source Records (Raw ingested items & payloads)
CREATE TABLE IF NOT EXISTS source_records (
    tenant_id              text        NOT NULL CHECK (tenant_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    record_id              text        NOT NULL CHECK (record_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    source_id              text        NOT NULL,
    source_ref             text        NOT NULL,
    source_type            text        NOT NULL,
    raw_uri                text        NOT NULL,
    content_hash           text        NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
    ingested_at            timestamptz NOT NULL DEFAULT now(),
    payload                jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at             timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, record_id)
);
CREATE INDEX IF NOT EXISTS idx_source_records_tenant_id ON source_records (tenant_id);
CREATE INDEX IF NOT EXISTS idx_source_records_source_ref ON source_records (tenant_id, source_id, source_ref);
CREATE INDEX IF NOT EXISTS idx_source_records_hash ON source_records (tenant_id, content_hash);

-- 4. Documents (Ingested and normalized documents)
CREATE TABLE IF NOT EXISTS documents (
    tenant_id              text        NOT NULL CHECK (tenant_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    document_id            text        NOT NULL CHECK (document_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    project_id             text,
    title                  text        NOT NULL,
    doc_type               text        NOT NULL DEFAULT 'document',
    mime_type              text        NOT NULL DEFAULT 'application/octet-stream',
    size_bytes             bigint      NOT NULL DEFAULT 0,
    storage_ref            text        NOT NULL,
    source_id              text,
    source_ref             text,
    content_hash           text        NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
    ingested_at            timestamptz NOT NULL DEFAULT now(),
    metadata               jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, document_id),
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, project_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_tenant_id ON documents (tenant_id);
CREATE INDEX IF NOT EXISTS idx_documents_project_id ON documents (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents (tenant_id, content_hash);

-- 5. Chunks (Vector and textual context spans)
CREATE TABLE IF NOT EXISTS chunks (
    tenant_id              text        NOT NULL CHECK (tenant_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    chunk_id               text        NOT NULL CHECK (chunk_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    document_id            text        NOT NULL,
    chunk_index            integer     NOT NULL DEFAULT 0,
    text_content           text        NOT NULL,
    token_count            integer     NOT NULL DEFAULT 0,
    embedding_id           text,
    source_id              text,
    source_ref             text,
    content_hash           text        NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
    ingested_at            timestamptz NOT NULL DEFAULT now(),
    metadata               jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at             timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, chunk_id),
    FOREIGN KEY (tenant_id, document_id) REFERENCES documents (tenant_id, document_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chunks_tenant_id ON chunks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks (tenant_id, document_id);

-- 6. Entities (Knowledge graph nodes)
CREATE TABLE IF NOT EXISTS entities (
    tenant_id              text        NOT NULL CHECK (tenant_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    entity_id              text        NOT NULL CHECK (entity_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    entity_type            text        NOT NULL,
    canonical_name         text        NOT NULL,
    description            text,
    status                 text        NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'merged', 'deprecated')),
    source_id              text,
    source_ref             text,
    content_hash           text,
    ingested_at            timestamptz NOT NULL DEFAULT now(),
    attributes             jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_entities_tenant_id ON entities (tenant_id);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities (tenant_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_canonical ON entities (tenant_id, canonical_name);

-- 7. Aliases (Entity resolution surface forms)
CREATE TABLE IF NOT EXISTS aliases (
    tenant_id              text        NOT NULL CHECK (tenant_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    alias_id               text        NOT NULL CHECK (alias_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    entity_id              text        NOT NULL,
    alias_name             text        NOT NULL,
    confidence             numeric(5,4) NOT NULL DEFAULT 1.0000,
    source_id              text,
    source_ref             text,
    ingested_at            timestamptz NOT NULL DEFAULT now(),
    created_at             timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, alias_id),
    FOREIGN KEY (tenant_id, entity_id) REFERENCES entities (tenant_id, entity_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_aliases_tenant_id ON aliases (tenant_id);
CREATE INDEX IF NOT EXISTS idx_aliases_name ON aliases (tenant_id, alias_name);
CREATE INDEX IF NOT EXISTS idx_aliases_entity ON aliases (tenant_id, entity_id);

-- 8. Edges (Temporal knowledge graph relations)
CREATE TABLE IF NOT EXISTS edges (
    tenant_id              text        NOT NULL CHECK (tenant_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    edge_id                text        NOT NULL CHECK (edge_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    source_entity_id       text        NOT NULL,
    target_entity_id       text        NOT NULL,
    relation_type          text        NOT NULL,
    valid_from             timestamptz NOT NULL DEFAULT now(),
    valid_to               timestamptz,
    confidence             numeric(5,4) NOT NULL DEFAULT 1.0000,
    source_id              text,
    source_ref             text,
    content_hash           text,
    ingested_at            timestamptz NOT NULL DEFAULT now(),
    properties             jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at             timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, edge_id),
    FOREIGN KEY (tenant_id, source_entity_id) REFERENCES entities (tenant_id, entity_id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, target_entity_id) REFERENCES entities (tenant_id, entity_id) ON DELETE CASCADE,
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX IF NOT EXISTS idx_edges_tenant_id ON edges (tenant_id);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges (tenant_id, source_entity_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges (tenant_id, target_entity_id);
CREATE INDEX IF NOT EXISTS idx_edges_temporal ON edges (tenant_id, valid_from, valid_to);
CREATE INDEX IF NOT EXISTS idx_edges_relation ON edges (tenant_id, relation_type);

-- 9. Events (Chronological, typed domain events)
CREATE TABLE IF NOT EXISTS events (
    tenant_id              text        NOT NULL CHECK (tenant_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    event_id               text        NOT NULL CHECK (event_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    event_type             text        NOT NULL,
    project_id             text,
    occurred_at            timestamptz NOT NULL,
    title                  text        NOT NULL,
    description            text,
    confidence             numeric(5,4) NOT NULL DEFAULT 1.0000,
    source_id              text,
    source_ref             text,
    content_hash           text,
    ingested_at            timestamptz NOT NULL DEFAULT now(),
    payload                jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at             timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, event_id),
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, project_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_events_tenant_id ON events (tenant_id);
CREATE INDEX IF NOT EXISTS idx_events_occurred_at ON events (tenant_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_type ON events (tenant_id, event_type);

-- 10. Decisions (Decision Memory)
CREATE TABLE IF NOT EXISTS decisions (
    tenant_id              text        NOT NULL CHECK (tenant_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    decision_id            text        NOT NULL CHECK (decision_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    project_id             text,
    title                  text        NOT NULL,
    description            text        NOT NULL,
    rationale              text,
    status                 text        NOT NULL DEFAULT 'decided'
                           CHECK (status IN ('proposed', 'decided', 'superseded', 'revoked')),
    decided_by             text,
    decided_at             timestamptz NOT NULL DEFAULT now(),
    superseded_by          text,
    source_id              text,
    source_ref             text,
    content_hash           text,
    ingested_at            timestamptz NOT NULL DEFAULT now(),
    metadata               jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, decision_id),
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, project_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_decisions_tenant_id ON decisions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions (tenant_id, status);

-- 11. Finance Transactions
CREATE TABLE IF NOT EXISTS finance_txns (
    tenant_id              text        NOT NULL CHECK (tenant_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    txn_id                 text        NOT NULL CHECK (txn_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    project_id             text,
    txn_type               text        NOT NULL
                           CHECK (txn_type IN ('invoice', 'payment', 'credit_note', 'debit_note', 'change_order')),
    txn_ref                text        NOT NULL,
    amount                 numeric(15,2) NOT NULL,
    currency               text        NOT NULL DEFAULT 'INR',
    status                 text        NOT NULL DEFAULT 'completed'
                           CHECK (status IN ('pending', 'completed', 'overdue', 'cancelled', 'disputed')),
    counterparty_entity_id text,
    txn_date               date        NOT NULL,
    due_date               date,
    source_id              text,
    source_ref             text,
    content_hash           text,
    ingested_at            timestamptz NOT NULL DEFAULT now(),
    metadata               jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, txn_id),
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, project_id) ON DELETE SET NULL,
    FOREIGN KEY (tenant_id, counterparty_entity_id) REFERENCES entities (tenant_id, entity_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_finance_txns_tenant_id ON finance_txns (tenant_id);
CREATE INDEX IF NOT EXISTS idx_finance_txns_project ON finance_txns (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_finance_txns_date ON finance_txns (tenant_id, txn_date);

-- Tenant Isolation (Risk R-6): FORCE Row Level Security on all core tables
ALTER TABLE users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE users          FORCE  ROW LEVEL SECURITY;
ALTER TABLE projects       ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects       FORCE  ROW LEVEL SECURITY;
ALTER TABLE source_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_records FORCE  ROW LEVEL SECURITY;
ALTER TABLE documents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents      FORCE  ROW LEVEL SECURITY;
ALTER TABLE chunks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks         FORCE  ROW LEVEL SECURITY;
ALTER TABLE entities       ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities       FORCE  ROW LEVEL SECURITY;
ALTER TABLE aliases        ENABLE ROW LEVEL SECURITY;
ALTER TABLE aliases        FORCE  ROW LEVEL SECURITY;
ALTER TABLE edges          ENABLE ROW LEVEL SECURITY;
ALTER TABLE edges          FORCE  ROW LEVEL SECURITY;
ALTER TABLE events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE events         FORCE  ROW LEVEL SECURITY;
ALTER TABLE decisions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE decisions      FORCE  ROW LEVEL SECURITY;
ALTER TABLE finance_txns   ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_txns   FORCE  ROW LEVEL SECURITY;

CREATE POLICY users_tenant_isolation ON users
    USING (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY projects_tenant_isolation ON projects
    USING (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY source_records_tenant_isolation ON source_records
    USING (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY documents_tenant_isolation ON documents
    USING (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY chunks_tenant_isolation ON chunks
    USING (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY entities_tenant_isolation ON entities
    USING (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY aliases_tenant_isolation ON aliases
    USING (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY edges_tenant_isolation ON edges
    USING (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY events_tenant_isolation ON events
    USING (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY decisions_tenant_isolation ON decisions
    USING (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY finance_txns_tenant_isolation ON finance_txns
    USING (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
