-- Owner task: EB-85 Tenant registry and control plane
-- Status: DRAFT — not yet run against Postgres (no local database); apply after 0001 (EB-19) and RLS (EB-20).
-- Postgres implementation of storage.CredentialBackend. Rows hold only the sealed envelope
-- (AES-256-GCM, data key wrapped by the tenant's KMS key, Risk R-12) — never a plaintext secret.
-- Destroying the tenant key (OffboardTenant) makes every row unreadable, backups included.

CREATE TABLE IF NOT EXISTS connector_credentials (
    tenant_id      text        NOT NULL CHECK (tenant_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    credential_id  text        NOT NULL CHECK (credential_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    connector_type text        NOT NULL,
    display_name   text        NOT NULL,
    version        integer     NOT NULL CHECK (version > 0),   -- compare-and-set on every save
    status         text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'needs_reauth')),
    expires_at     timestamptz,
    envelope       jsonb       NOT NULL CHECK (envelope ? 'wrapped_key' AND envelope ? 'ciphertext'
                                               AND envelope ->> 'alg' = 'AES-256-GCM'),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, credential_id)
);

-- Tenant isolation (Risk R-6): the app role runs NOBYPASSRLS and sets app.tenant_id per transaction.
ALTER TABLE connector_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_credentials FORCE  ROW LEVEL SECURITY;

CREATE POLICY connector_credentials_tenant_isolation ON connector_credentials
    USING (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Refresh lock: pg_advisory_xact_lock(hashtextextended(tenant_id || ':' || credential_id, 0)) inside the
-- refresh transaction, the Postgres equivalent of FileCredentialBackend.lock.
