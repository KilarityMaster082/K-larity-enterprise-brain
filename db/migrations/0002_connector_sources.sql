-- Owner task: EB-28 Connector SDK and source registry
-- Status: DRAFT — not yet run against Postgres (no local database); apply after 0001 (EB-19) and RLS (EB-20).
-- Postgres implementation of connectors_sdk.state.SourceStateStore. Raw bytes live in object storage;
-- only metadata, cursors and content hashes are stored here.

CREATE TABLE IF NOT EXISTS sources (
    tenant_id              text        NOT NULL CHECK (tenant_id ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$'),
    source_id              text        NOT NULL CHECK (source_id ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$'),
    connector_type         text        NOT NULL,
    connector_version      text        NOT NULL DEFAULT '1',
    display_name           text        NOT NULL,
    config                 jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- never credentials (EB-85 credential store)
    enabled                boolean     NOT NULL DEFAULT true,
    cursor                 jsonb,
    health                 text        NOT NULL DEFAULT 'never_run'
                           CHECK (health IN ('never_run', 'ok', 'degraded', 'failing', 'auth_error')),
    last_sync_started_at   timestamptz,
    last_sync_finished_at  timestamptz,
    last_error             text,
    consecutive_failures   integer     NOT NULL DEFAULT 0,
    items_seen             bigint      NOT NULL DEFAULT 0,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, source_id)
);

CREATE TABLE IF NOT EXISTS source_items (
    tenant_id     text        NOT NULL,
    source_id     text        NOT NULL,
    external_id   text        NOT NULL,
    content_hash  text        NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
    raw_ref       text        NOT NULL,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, source_id, external_id),
    FOREIGN KEY (tenant_id, source_id) REFERENCES sources (tenant_id, source_id) ON DELETE CASCADE
);

-- Tenant isolation (Risk R-6): the app role runs NOBYPASSRLS and sets app.tenant_id per transaction.
ALTER TABLE sources      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sources      FORCE  ROW LEVEL SECURITY;
ALTER TABLE source_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_items FORCE  ROW LEVEL SECURITY;

CREATE POLICY sources_tenant_isolation ON sources
    USING (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY source_items_tenant_isolation ON source_items
    USING (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
