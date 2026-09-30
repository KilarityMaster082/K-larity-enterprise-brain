-- Owner task: EB-55 Financial Brain page
-- Package budgets per project. The Finance and Executive screens compare the ledger's committed cost against these
-- lines (views in db/views/finance.sql). Tenant isolation as everywhere else (Risk R-6): tenant_id NOT NULL,
-- composite foreign key scoped to tenant_id, FORCE row-level security.

CREATE TABLE IF NOT EXISTS finance_budget_lines (
    tenant_id              text        NOT NULL CHECK (tenant_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    project_id             text        NOT NULL CHECK (project_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    package                text        NOT NULL,
    budget                 numeric(15,2) NOT NULL CHECK (budget >= 0),
    currency               text        NOT NULL DEFAULT 'INR',
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, project_id, package),
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, project_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_finance_budget_lines_tenant_id ON finance_budget_lines (tenant_id);

ALTER TABLE finance_budget_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_budget_lines FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS finance_budget_lines_tenant_isolation ON finance_budget_lines;
CREATE POLICY finance_budget_lines_tenant_isolation ON finance_budget_lines
    USING (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
