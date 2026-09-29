-- Owner task: EB-19 Database schema v1
-- Rollback for 0001_initial.sql
-- Drops tables in reverse dependency order.

DROP POLICY IF EXISTS finance_txns_tenant_isolation ON finance_txns;
DROP POLICY IF EXISTS decisions_tenant_isolation ON decisions;
DROP POLICY IF EXISTS events_tenant_isolation ON events;
DROP POLICY IF EXISTS edges_tenant_isolation ON edges;
DROP POLICY IF EXISTS aliases_tenant_isolation ON aliases;
DROP POLICY IF EXISTS entities_tenant_isolation ON entities;
DROP POLICY IF EXISTS chunks_tenant_isolation ON chunks;
DROP POLICY IF EXISTS documents_tenant_isolation ON documents;
DROP POLICY IF EXISTS source_records_tenant_isolation ON source_records;
DROP POLICY IF EXISTS projects_tenant_isolation ON projects;
DROP POLICY IF EXISTS users_tenant_isolation ON users;

DROP TABLE IF EXISTS finance_txns;
DROP TABLE IF EXISTS decisions;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS edges;
DROP TABLE IF EXISTS aliases;
DROP TABLE IF EXISTS entities;
DROP TABLE IF EXISTS chunks;
DROP TABLE IF EXISTS documents;
DROP TABLE IF EXISTS source_records;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS users;
