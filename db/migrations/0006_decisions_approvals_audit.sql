-- Owner task: EB-53 Decision Memory · EB-66 Approval model · EB-24 Audit log
-- 1. decisions: columns the Decision Memory service persists (drafts have no decided_at yet).
-- 2. approvals: durable, tenant-scoped approval requests.
-- 3. audit_log: the append-only audit trail (the table never had a PostgreSQL definition before this migration).
-- Every table: tenant_id NOT NULL, FORCE row-level security keyed on app.tenant_id (Risk R-6).

ALTER TABLE decisions ALTER COLUMN decided_at DROP NOT NULL;
ALTER TABLE decisions ALTER COLUMN decided_at DROP DEFAULT;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS alternatives      jsonb        NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS evidence_ids      jsonb        NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS cost_impact       numeric(15,2);
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS time_impact_days  integer;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS confidence        numeric(5,4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS reviewed_by       text;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS review_note       text;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS version           integer      NOT NULL DEFAULT 1;
-- a decided decision must say who decided it and when; a draft must not
ALTER TABLE decisions DROP CONSTRAINT IF EXISTS decisions_decided_fields;
ALTER TABLE decisions ADD CONSTRAINT decisions_decided_fields CHECK (
    status <> 'decided' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL));

CREATE TABLE IF NOT EXISTS approvals (
    tenant_id     text        NOT NULL CHECK (tenant_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    approval_id   text        NOT NULL,
    kind          text        NOT NULL CHECK (kind IN ('draft_message', 'create_task', 'update_record')),
    title         text        NOT NULL,
    body          text        NOT NULL,
    project_id    text,
    requested_by  text        NOT NULL,
    requested_via text        NOT NULL CHECK (requested_via IN ('ask_brain', 'agent', 'person')),
    requested_at  timestamptz NOT NULL,
    reason        text        NOT NULL CHECK (length(btrim(reason)) > 0),
    evidence_ids  jsonb       NOT NULL CHECK (jsonb_typeof(evidence_ids) = 'array' AND jsonb_array_length(evidence_ids) > 0),
    payload       jsonb       NOT NULL DEFAULT '{}'::jsonb,
    status        text        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled', 'executed')),
    expires_at    timestamptz,
    decided_by    text,
    decided_at    timestamptz,
    note          text,
    executed_at   timestamptz,
    rev           integer     NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, approval_id),
    -- separation of duties, enforced by the database as well as the service
    CONSTRAINT approvals_no_self_decision CHECK (status NOT IN ('approved', 'rejected') OR decided_by IS DISTINCT FROM requested_by),
    CONSTRAINT approvals_executed_only_after_approval CHECK (status <> 'executed' OR (executed_at IS NOT NULL AND decided_by IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_approvals_tenant_status ON approvals (tenant_id, status, requested_at);

CREATE TABLE IF NOT EXISTS audit_log (
    audit_id    text        NOT NULL,
    tenant_id   text        NOT NULL CHECK (tenant_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    user_id     text,
    action      text        NOT NULL,
    entity_type text        NOT NULL,
    entity_id   text        NOT NULL,
    details     jsonb       NOT NULL DEFAULT '{}'::jsonb,
    ip_address  text,
    user_agent  text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, audit_id)
);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_time ON audit_log (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log (tenant_id, entity_type, entity_id);

-- Append-only for EVERY role, including the table owner: a trigger, not just revoked grants (grants are re-applied
-- by db/policies/roles.sql and can be changed by an admin; a trigger cannot be bypassed by an UPDATE statement).
CREATE OR REPLACE FUNCTION klarity_audit_log_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only (% denied)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_log_no_update_delete ON audit_log;
CREATE TRIGGER audit_log_no_update_delete BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION klarity_audit_log_append_only();
DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION klarity_audit_log_append_only();

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['approvals', 'audit_log'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
        EXECUTE format('CREATE POLICY %I ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) '
                       'WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))', t || '_tenant_isolation', t);
    END LOOP;
END;
$$;
