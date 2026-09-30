-- Owner task: EB-55 Financial Brain page
DROP POLICY IF EXISTS finance_budget_lines_tenant_isolation ON finance_budget_lines;
DROP TABLE IF EXISTS finance_budget_lines;
