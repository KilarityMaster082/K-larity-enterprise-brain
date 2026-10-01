-- Owner task: EB-20 RLS and tenant middleware
-- Application role definition for K!larity Enterprise Brain.
-- The application role (klarity_app) is explicitly NON-SUPERUSER and carries NOBYPASSRLS
-- so that PostgreSQL row-level security (FORCE RLS) can never be bypassed.
-- The role has access ONLY to the tenant data schema in the tenant database,
-- and has zero grants in the control-plane database (ADR-011, Risk R-6).

BEGIN;

-- 1. Create application user/role if it does not already exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'klarity_app') THEN
        CREATE ROLE klarity_app WITH
            LOGIN
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            NOINHERIT
            NOREPLICATION
            NOBYPASSRLS
            CONNECTION LIMIT 100;
    ELSE
        -- Ensure NOBYPASSRLS is strictly enforced even if modified externally
        ALTER ROLE klarity_app WITH NOBYPASSRLS NOSUPERUSER;
    END IF;
END;
$$;

-- 2. Schema USAGE
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO klarity_app;

-- 3. Table Permissions: CRUD on all tenant data tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO klarity_app;

-- 4. Future tables in public schema automatically inherit CRUD permissions
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO klarity_app;

-- 5. Sequence Permissions for serial / auto-incrementing counters
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO klarity_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO klarity_app;

-- 6. Helper Routine Execution
GRANT EXECUTE ON FUNCTION klarity_set_tenant(text) TO klarity_app;
GRANT EXECUTE ON FUNCTION klarity_current_tenant() TO klarity_app;
GRANT EXECUTE ON FUNCTION klarity_reset_tenant() TO klarity_app;

-- 7. The audit trail is append-only for the application role. (The trigger in migration 0006 enforces it for every
-- role; this removes the grants too, after the blanket GRANT above.)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_log') THEN
        REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM klarity_app;
    END IF;
END;
$$;

COMMIT;
