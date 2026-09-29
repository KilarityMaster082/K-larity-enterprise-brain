-- Owner task: EB-29 Temporal ingestion pipeline
-- Status: DRAFT — not yet run against Postgres (no local database); apply after 0001 (EB-19) and RLS (EB-20).
-- Dead-letter queue for failed ingestion pipeline activities (parsing, chunking, embedding, indexing).
-- Allows administrators to inspect failures, see stack traces, and trigger replay after fixing upstream issues.

CREATE TABLE IF NOT EXISTS ingestion_dead_letter (
    id                     bigserial   PRIMARY KEY,
    tenant_id              text        NOT NULL CHECK (tenant_id ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$'),
    source_id              text        NOT NULL CHECK (source_id ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$'),
    item_ref               text        NOT NULL,
    stage                  text        NOT NULL CHECK (stage IN ('sync', 'parse', 'chunk', 'embed', 'index', 'extract_events', 'resolve_entities')),
    error_type             text        NOT NULL,
    error_message          text        NOT NULL,
    attempt_count          integer     NOT NULL DEFAULT 1,
    idempotency_key        text        NOT NULL,
    payload_ref            text,
    failed_at              timestamptz NOT NULL DEFAULT now(),
    resolved_at            timestamptz,
    resolved_by            text,
    resolution_notes       text
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_tenant_source ON ingestion_dead_letter (tenant_id, source_id, failed_at DESC);
CREATE INDEX IF NOT EXISTS idx_dead_letter_idempotency ON ingestion_dead_letter (idempotency_key);

-- Tenant isolation (Risk R-6): NOBYPASSRLS app role requires tenant_id match.
ALTER TABLE ingestion_dead_letter ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_dead_letter FORCE  ROW LEVEL SECURITY;

CREATE POLICY ingestion_dead_letter_tenant_isolation ON ingestion_dead_letter
    USING (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
