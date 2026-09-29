-- Owner task: EB-85 Tenant registry and control plane
-- Control-plane database: the registry of every tenant and where its data lives (foundation-fit §4.4,
-- ADR-011, ADR-014). It is a SEPARATE database from tenant data and has no RLS: only the control-plane
-- role may connect. The application role (klarity_app) gets no grants here and reaches placement only
-- through the control-plane service / TenantDirectory.
-- Status: DRAFT — written for PostgreSQL 16, not yet run (no Postgres in the dev environment).
-- Python mirror for dev/tests: services/control-plane/control_plane/registry.py (FileTenantRegistry).

BEGIN;

REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- One full copy of the stack. Values are resource names; endpoints and secrets live in deploy config.
CREATE TABLE cells (
    cell_id            text PRIMARY KEY CHECK (cell_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    region             text NOT NULL,
    kind               text NOT NULL CHECK (kind IN ('shared', 'dedicated')),
    status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draining', 'retired')),
    pg_cluster         text NOT NULL,
    object_bucket      text NOT NULL,
    qdrant_cluster     text NOT NULL,
    opensearch_cluster text NOT NULL,
    fga_store          text NOT NULL,
    temporal_namespace text NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plans (
    plan_id      text PRIMARY KEY,
    display_name text NOT NULL,
    is_active    boolean NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenants (
    tenant_id    text PRIMARY KEY CHECK (tenant_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    slug         text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    display_name text NOT NULL,
    status       text NOT NULL DEFAULT 'provisioning'
                 CHECK (status IN ('provisioning', 'active', 'suspended', 'offboarding', 'offboarded')),
    tier         text NOT NULL CHECK (tier IN ('pool', 'bridge', 'silo')),
    plan_id      text NOT NULL REFERENCES plans (plan_id),
    cell_id      text NOT NULL REFERENCES cells (cell_id),
    region       text NOT NULL,               -- copied from the cell at registration; residency record
    is_synthetic boolean NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tenants_cell_idx ON tenants (cell_id);
-- A dedicated (silo) cell holds at most one live tenant; enforced in the registry service.

-- Placement: one row per resource kind (see tenant_context.Placement for the kinds).
CREATE TABLE tenant_resources (
    tenant_id  text NOT NULL REFERENCES tenants (tenant_id),
    kind       text NOT NULL,
    ref        text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, kind)
);
-- Per-tenant resources must never be shared between tenants.
CREATE UNIQUE INDEX tenant_resources_unique_ref ON tenant_resources (kind, ref)
    WHERE kind IN ('object_prefix', 'opensearch_alias', 'litellm_team', 'kms_key_ref', 'keycloak_org_id');

-- Entitlements (EB-87 owns the logic; tables live here so placement and limits share one registry).
CREATE TABLE entitlements (
    plan_id     text NOT NULL REFERENCES plans (plan_id),
    entitlement text NOT NULL,                -- e.g. 'connectors.max', 'llm.monthly_tokens'
    value       jsonb NOT NULL,
    PRIMARY KEY (plan_id, entitlement)
);

CREATE TABLE tenant_overrides (
    tenant_id   text NOT NULL REFERENCES tenants (tenant_id),
    entitlement text NOT NULL,
    value       jsonb NOT NULL,
    reason      text NOT NULL,
    set_by      text NOT NULL,
    expires_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, entitlement)
);

-- Append-only usage events rolled up daily for billing and cost-to-serve (EB-87).
CREATE TABLE usage_ledger (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id       text NOT NULL REFERENCES tenants (tenant_id),
    meter           text NOT NULL,
    quantity        numeric NOT NULL CHECK (quantity >= 0),
    occurred_at     timestamptz NOT NULL,
    source          text NOT NULL,
    idempotency_key text NOT NULL,
    recorded_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX usage_ledger_tenant_time_idx ON usage_ledger (tenant_id, occurred_at);

-- Roles are created by deploy; here we only grant. Ledger is insert-only even for the control plane.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'klarity_control') THEN
        GRANT USAGE ON SCHEMA public TO klarity_control;
        GRANT SELECT, INSERT, UPDATE ON cells, plans, tenants, tenant_resources, entitlements,
            tenant_overrides TO klarity_control;
        GRANT DELETE ON tenant_overrides TO klarity_control;
        GRANT SELECT, INSERT ON usage_ledger TO klarity_control;
    END IF;
END $$;

COMMIT;
