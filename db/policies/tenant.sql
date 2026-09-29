-- Owner task: EB-20 RLS and tenant middleware
-- PostgreSQL Row-Level Security (FORCE RLS) policies for all tenant-scoped tables.
-- Guarantees that the application role (klarity_app) running under NOBYPASSRLS cannot
-- read, insert, update or delete any row whose tenant_id does not match the session
-- variable app.tenant_id (Risk R-6 multi-tenant data leakage mitigation).

BEGIN;

-- Helper routine to set active tenant within a transaction
CREATE OR REPLACE FUNCTION klarity_set_tenant(p_tenant_id text)
RETURNS void AS $$
BEGIN
    IF p_tenant_id IS NULL OR p_tenant_id !~ '^[a-z0-9][a-z0-9-]{1,62}$' THEN
        RAISE EXCEPTION 'Invalid tenant identifier format: %', p_tenant_id
            USING ERRCODE = 'check_violation';
    END IF;
    PERFORM set_config('app.tenant_id', p_tenant_id, true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper routine to read active tenant
CREATE OR REPLACE FUNCTION klarity_current_tenant()
RETURNS text AS $$
BEGIN
    RETURN current_setting('app.tenant_id', true);
END;
$$ LANGUAGE plpgsql STABLE;

-- Helper routine to reset active tenant
CREATE OR REPLACE FUNCTION klarity_reset_tenant()
RETURNS void AS $$
BEGIN
    PERFORM set_config('app.tenant_id', '', true);
END;
$$ LANGUAGE plpgsql;

-- Apply Row-Level Security and FORCE RLS to all core data tables
DO $$
DECLARE
    t text;
    tenant_tables text[] := ARRAY[
        'users',
        'projects',
        'source_records',
        'documents',
        'chunks',
        'entities',
        'aliases',
        'edges',
        'events',
        'decisions',
        'finance_txns',
        'sources',
        'source_items',
        'connector_credentials'
    ];
BEGIN
    FOREACH t IN ARRAY tenant_tables LOOP
        -- Only apply if table exists
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
            EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
            EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY;', t);

            -- Drop old policy if present and recreate canonical tenant isolation policy
            EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t || '_tenant_isolation', t);
            EXECUTE format(
                'CREATE POLICY %I ON %I ' ||
                'USING (tenant_id = current_setting(''app.tenant_id'', true)) ' ||
                'WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true));',
                t || '_tenant_isolation', t
            );
        END IF;
    END LOOP;
END;
$$;

COMMIT;
