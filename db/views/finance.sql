-- Owner task: EB-55 Financial Brain page
-- Reviewed finance views. CLAUDE.md rule 3: every rupee figure on the Finance and Executive screens comes from one of
-- these views or functions, never from free-form model output. apps/web/lib/finance-sql.ts registers the same names
-- and columns; tests/finance-sql.test.ts and packages/ontology/tests/test_finance_views.py keep the three in step,
-- and the Python test runs them against PostgreSQL and compares with the web app's derivations row for row.
--
-- Tenant isolation (Risk R-6): every view is security_invoker, so the caller's FORCE row-level security on
-- finance_txns, finance_budget_lines, projects, entities and documents applies. Functions are SECURITY INVOKER.
-- Amounts are rupees (numeric(15,2)); the UI formats them as lakh/crore. "as of" dates are IST calendar dates.

-- ---------------------------------------------------------------- base: the ledger, normalised
-- direction: 'receivable' (billed to the client) or 'payable' (owed to a vendor), package and counterparty come
-- from the row's metadata until the ingestion pipeline writes them as columns.
CREATE OR REPLACE VIEW finance_txn WITH (security_invoker = true) AS
SELECT t.tenant_id,
       t.txn_id,
       t.project_id,
       t.txn_type,
       t.txn_ref,
       t.amount,
       t.currency,
       t.status,
       t.metadata ->> 'direction'                           AS direction,
       t.metadata ->> 'package'                             AS package,
       COALESCE(t.metadata ->> 'counterparty', e.canonical_name) AS counterparty,
       t.txn_date,
       t.due_date,
       t.source_ref                                         AS evidence_ref
FROM finance_txns t
LEFT JOIN entities e
       ON e.tenant_id = t.tenant_id AND e.entity_id = t.counterparty_entity_id;

-- ---------------------------------------------------------------- budget vs committed, per package
CREATE OR REPLACE VIEW finance_variance_by_package WITH (security_invoker = true) AS
SELECT b.tenant_id,
       b.project_id,
       b.package,
       b.budget,
       COALESCE(SUM(t.amount), 0)::numeric(15,2)                          AS committed,
       GREATEST(COALESCE(SUM(t.amount), 0) - b.budget, 0)::numeric(15,2)  AS overrun
FROM finance_budget_lines b
LEFT JOIN finance_txn t
       ON t.tenant_id = b.tenant_id
      AND t.project_id = b.project_id
      AND t.package = b.package
      AND t.direction = 'payable'
      AND t.status <> 'cancelled'
GROUP BY b.tenant_id, b.project_id, b.package, b.budget;

-- ---------------------------------------------------------------- one row per project
CREATE OR REPLACE VIEW finance_project_summary WITH (security_invoker = true) AS
WITH lines AS (
    SELECT tenant_id, project_id,
           SUM(budget) AS line_budget, SUM(committed) AS committed, SUM(overrun) AS overrun
    FROM finance_variance_by_package
    GROUP BY tenant_id, project_id
), recv AS (
    SELECT tenant_id, project_id,
           SUM(amount)                                      AS billed,
           SUM(amount) FILTER (WHERE status = 'completed')  AS collected,
           SUM(amount) FILTER (WHERE status = 'overdue')    AS overdue
    FROM finance_txn
    WHERE direction = 'receivable' AND status <> 'cancelled'
    GROUP BY tenant_id, project_id
)
SELECT p.tenant_id,
       p.project_id,
       COALESCE(p.budget, l.line_budget, 0)::numeric(15,2)                                   AS budget,
       COALESCE(l.committed, 0)::numeric(15,2)                                               AS committed,
       COALESCE(l.overrun, 0)::numeric(15,2)                                                 AS overrun,
       (COALESCE(p.budget, l.line_budget, 0) + COALESCE(l.overrun, 0))::numeric(15,2)        AS forecast,
       CASE WHEN COALESCE(p.budget, l.line_budget, 0) > 0
            THEN COALESCE(l.overrun, 0) / COALESCE(p.budget, l.line_budget)
            ELSE 0 END::numeric(9,6)                                                         AS overrun_pct,
       COALESCE(r.billed, 0)::numeric(15,2)                                                  AS billed,
       COALESCE(r.collected, 0)::numeric(15,2)                                               AS collected,
       (COALESCE(r.billed, 0) - COALESCE(r.collected, 0))::numeric(15,2)                     AS outstanding,
       COALESCE(r.overdue, 0)::numeric(15,2)                                                 AS overdue
FROM projects p
LEFT JOIN lines l ON l.tenant_id = p.tenant_id AND l.project_id = p.project_id
LEFT JOIN recv  r ON r.tenant_id = p.tenant_id AND r.project_id = p.project_id;

-- ---------------------------------------------------------------- open receivables and ageing
-- days_overdue: days past the due date (0 when not yet due). age_days / bucket: days since the invoice date.
CREATE OR REPLACE FUNCTION finance_open_receivables(p_as_of date)
RETURNS TABLE (tenant_id text, txn_id text, project_id text, txn_ref text, counterparty text, amount numeric,
               status text, txn_date date, due_date date, days_overdue integer, age_days integer, bucket text)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    SELECT t.tenant_id, t.txn_id, t.project_id, t.txn_ref, t.counterparty, t.amount, t.status, t.txn_date, t.due_date,
           CASE WHEN t.due_date IS NULL THEN 0 ELSE GREATEST(0, p_as_of - t.due_date) END                 AS days_overdue,
           GREATEST(0, p_as_of - t.txn_date)                                                               AS age_days,
           CASE WHEN GREATEST(0, p_as_of - t.txn_date) <= 30 THEN '0–30 d'
                WHEN GREATEST(0, p_as_of - t.txn_date) <= 60 THEN '31–60 d'
                WHEN GREATEST(0, p_as_of - t.txn_date) <= 90 THEN '61–90 d'
                ELSE '90+ d' END                                                                           AS bucket
    FROM finance_txn t
    WHERE t.direction = 'receivable' AND t.status IN ('pending', 'overdue')
$$;

CREATE OR REPLACE FUNCTION finance_receivables_ageing(p_as_of date)
RETURNS TABLE (tenant_id text, bucket text, amount numeric)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    SELECT tn.tenant_id, b.bucket, COALESCE(SUM(r.amount), 0)::numeric
    FROM (SELECT DISTINCT tenant_id FROM finance_txn) tn
    CROSS JOIN (VALUES ('0–30 d', 1), ('31–60 d', 2), ('61–90 d', 3), ('90+ d', 4)) AS b(bucket, ord)
    LEFT JOIN finance_open_receivables(p_as_of) r ON r.tenant_id = tn.tenant_id AND r.bucket = b.bucket
    GROUP BY tn.tenant_id, b.bucket, b.ord
    ORDER BY tn.tenant_id, b.ord
$$;

-- ---------------------------------------------------------------- payables falling due
CREATE OR REPLACE FUNCTION finance_payables_due(p_as_of date, p_days integer)
RETURNS TABLE (tenant_id text, txn_id text, project_id text, txn_ref text, counterparty text, package text,
               amount numeric, due_date date)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    SELECT t.tenant_id, t.txn_id, t.project_id, t.txn_ref, t.counterparty, t.package, t.amount, t.due_date
    FROM finance_txn t
    WHERE t.direction = 'payable' AND t.status = 'pending' AND t.due_date IS NOT NULL
      AND t.due_date <= p_as_of + p_days
    ORDER BY t.due_date, t.txn_id
$$;

-- ---------------------------------------------------------------- margin leakage
-- unsigned_variation: a contract/variation with a value that the counterparty has not signed.
-- cost_not_billed:    a vendor change order with no client change order on the same project and package.
-- duplicate_invoice:  the second and later vendor invoices with the same counterparty, reference and amount.
CREATE OR REPLACE VIEW finance_leakage_flags WITH (security_invoker = true) AS
SELECT d.tenant_id,
       'unsigned-' || d.document_id                AS flag_id,
       'unsigned_variation'                        AS kind,
       d.project_id,
       NULL::text                                  AS txn_id,
       d.document_id,
       (d.metadata ->> 'amount')::numeric          AS amount
FROM documents d
WHERE d.doc_type = 'contract'
  AND d.metadata ->> 'signed' = 'false'
  AND d.metadata ->> 'amount' IS NOT NULL
UNION ALL
SELECT co.tenant_id, 'unbilled-' || co.txn_id, 'cost_not_billed', co.project_id, co.txn_id, NULL::text, co.amount
FROM finance_txn co
WHERE co.direction = 'payable' AND co.txn_type = 'change_order' AND co.status <> 'cancelled'
  AND NOT EXISTS (
      SELECT 1 FROM finance_txn c
      WHERE c.tenant_id = co.tenant_id AND c.project_id = co.project_id AND c.package = co.package
        AND c.direction = 'receivable' AND c.txn_type = 'change_order')
UNION ALL
SELECT x.tenant_id, 'dup-' || x.txn_id, 'duplicate_invoice', x.project_id, x.txn_id, NULL::text, x.amount
FROM (
    SELECT t.*, ROW_NUMBER() OVER (PARTITION BY t.tenant_id, t.counterparty, t.txn_ref, t.amount
                                   ORDER BY t.txn_date, t.txn_id) AS n
    FROM finance_txn t
    WHERE t.direction = 'payable' AND t.status <> 'cancelled'
) x
WHERE x.n > 1;

-- ---------------------------------------------------------------- cash
-- Net cash movement recorded in the ledger up to the date: completed receivables minus completed payables.
-- (Bank opening balances are not in the ledger, so this is a movement, not a balance.)
CREATE OR REPLACE FUNCTION finance_cash_position(p_as_of date)
RETURNS TABLE (tenant_id text, cash_in numeric, cash_out numeric, net numeric)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    SELECT t.tenant_id,
           COALESCE(SUM(t.amount) FILTER (WHERE t.direction = 'receivable'), 0)::numeric AS cash_in,
           COALESCE(SUM(t.amount) FILTER (WHERE t.direction = 'payable'), 0)::numeric    AS cash_out,
           (COALESCE(SUM(t.amount) FILTER (WHERE t.direction = 'receivable'), 0)
            - COALESCE(SUM(t.amount) FILTER (WHERE t.direction = 'payable'), 0))::numeric AS net
    FROM finance_txn t
    WHERE t.status = 'completed' AND t.txn_date <= p_as_of
    GROUP BY t.tenant_id
$$;

-- Twelve months ending with the month of p_as_of: cash in and out per month (completed rows, by transaction date).
CREATE OR REPLACE FUNCTION finance_cash_monthly(p_as_of date)
RETURNS TABLE (tenant_id text, month text, cash_in numeric, cash_out numeric)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    SELECT tn.tenant_id,
           to_char(m.month, 'YYYY-MM'),
           COALESCE(SUM(t.amount) FILTER (WHERE t.direction = 'receivable'), 0)::numeric,
           COALESCE(SUM(t.amount) FILTER (WHERE t.direction = 'payable'), 0)::numeric
    FROM (SELECT DISTINCT tenant_id FROM finance_txn) tn
    CROSS JOIN generate_series(date_trunc('month', p_as_of) - interval '11 months', date_trunc('month', p_as_of), interval '1 month') AS m(month)
    LEFT JOIN finance_txn t
           ON t.tenant_id = tn.tenant_id AND t.status = 'completed'
          AND date_trunc('month', t.txn_date) = m.month AND t.txn_date <= p_as_of
    GROUP BY tn.tenant_id, m.month
    ORDER BY tn.tenant_id, m.month
$$;

-- ---------------------------------------------------------------- executive summary (money only)
CREATE OR REPLACE FUNCTION finance_executive_summary(p_as_of date, p_days integer)
RETURNS TABLE (tenant_id text, outstanding numeric, overdue numeric, payables_due numeric, forecast_overrun numeric,
               leakage numeric, cash_net numeric)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    SELECT tn.tenant_id,
           COALESCE((SELECT SUM(r.amount) FROM finance_open_receivables(p_as_of) r WHERE r.tenant_id = tn.tenant_id), 0)::numeric,
           COALESCE((SELECT SUM(r.amount) FROM finance_open_receivables(p_as_of) r WHERE r.tenant_id = tn.tenant_id AND r.days_overdue > 0), 0)::numeric,
           COALESCE((SELECT SUM(p.amount) FROM finance_payables_due(p_as_of, p_days) p WHERE p.tenant_id = tn.tenant_id), 0)::numeric,
           COALESCE((SELECT SUM(s.overrun) FROM finance_project_summary s WHERE s.tenant_id = tn.tenant_id), 0)::numeric,
           COALESCE((SELECT SUM(f.amount) FROM finance_leakage_flags f WHERE f.tenant_id = tn.tenant_id), 0)::numeric,
           COALESCE((SELECT c.net FROM finance_cash_position(p_as_of) c WHERE c.tenant_id = tn.tenant_id), 0)::numeric
    FROM (SELECT DISTINCT tenant_id FROM finance_txn) tn
$$;

-- The application role reads the views and functions; it never gets write access here.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'klarity_app') THEN
        GRANT SELECT ON finance_txn, finance_variance_by_package, finance_project_summary, finance_leakage_flags TO klarity_app;
        GRANT EXECUTE ON FUNCTION finance_open_receivables(date), finance_receivables_ageing(date),
            finance_payables_due(date, integer), finance_cash_position(date), finance_cash_monthly(date),
            finance_executive_summary(date, integer) TO klarity_app;
    END IF;
END
$$;
