// Owner task: EB-55 Financial Brain page — the reviewed SQL views behind every rupee on the Finance and Executive
// screens, and the figure type that carries its origin. CLAUDE.md rule 3: numbers come from SQL, not from model output.
// db/views/finance.sql defines these names and columns; tests/finance-sql.test.ts parses that file and fails if this
// registry and the SQL drift apart, and packages/ontology/tests/test_finance_views.py runs the views on PostgreSQL and
// compares them with the derivations in lib/data/derive.ts row for row.

export const FINANCE_VIEWS = {
  finance_txn: {
    kind: "view",
    columns: ["tenant_id", "txn_id", "project_id", "txn_type", "txn_ref", "amount", "currency", "status", "direction", "package", "counterparty", "txn_date", "due_date", "evidence_ref"],
  },
  finance_variance_by_package: { kind: "view", columns: ["tenant_id", "project_id", "package", "budget", "committed", "overrun"] },
  finance_project_summary: {
    kind: "view",
    columns: ["tenant_id", "project_id", "budget", "committed", "overrun", "forecast", "overrun_pct", "billed", "collected", "outstanding", "overdue"],
  },
  finance_open_receivables: {
    kind: "function",
    args: ["p_as_of"],
    columns: ["tenant_id", "txn_id", "project_id", "txn_ref", "counterparty", "amount", "status", "txn_date", "due_date", "days_overdue", "age_days", "bucket"],
  },
  finance_receivables_ageing: { kind: "function", args: ["p_as_of"], columns: ["tenant_id", "bucket", "amount"] },
  finance_payables_due: { kind: "function", args: ["p_as_of", "p_days"], columns: ["tenant_id", "txn_id", "project_id", "txn_ref", "counterparty", "package", "amount", "due_date"] },
  finance_leakage_flags: { kind: "view", columns: ["tenant_id", "flag_id", "kind", "project_id", "txn_id", "document_id", "amount"] },
  finance_cash_position: { kind: "function", args: ["p_as_of"], columns: ["tenant_id", "cash_in", "cash_out", "net"] },
  finance_cash_monthly: { kind: "function", args: ["p_as_of"], columns: ["tenant_id", "month", "cash_in", "cash_out"] },
  finance_executive_summary: {
    kind: "function",
    args: ["p_as_of", "p_days"],
    columns: ["tenant_id", "outstanding", "overdue", "payables_due", "forecast_overrun", "leakage", "cash_net"],
  },
} as const;

export type FinanceView = keyof typeof FINANCE_VIEWS;

/** A rupee amount together with the reviewed view and column that produced it, scoped to one tenant. */
export interface SqlFigure {
  readonly amount: number;
  readonly view: FinanceView;
  readonly column: string;
  readonly tenantId: string;
  /** IST calendar date the function was evaluated for, when the view takes one. */
  readonly asOf?: string;
  /** Row the figure belongs to (project id, bucket, txn id) when the view returns several rows. */
  readonly key?: string;
}

export class SqlOriginError extends Error {}

function isView(v: string): v is FinanceView {
  return Object.prototype.hasOwnProperty.call(FINANCE_VIEWS, v);
}

/** Throws unless the figure names a registered view and one of its columns, is finite, and carries a tenant. */
export function assertSqlFigure(f: unknown): asserts f is SqlFigure {
  const x = f as Partial<SqlFigure> | null;
  if (!x || typeof x !== "object") throw new SqlOriginError("a figure must come from a reviewed SQL view");
  if (typeof x.view !== "string" || !isView(x.view)) throw new SqlOriginError(`unknown SQL view “${String(x.view)}”: figures come only from db/views/finance.sql`);
  const cols: readonly string[] = FINANCE_VIEWS[x.view].columns;
  if (typeof x.column !== "string" || !cols.includes(x.column)) throw new SqlOriginError(`${x.view} has no column “${String(x.column)}”`);
  if (typeof x.amount !== "number" || !Number.isFinite(x.amount)) throw new SqlOriginError(`${x.view}.${x.column} is not a finite number`);
  if (typeof x.tenantId !== "string" || !x.tenantId) throw new SqlOriginError("tenant_id is required at every data boundary");
}

export function sqlFigure(tenantId: string, view: FinanceView, column: string, amount: number, extra: { asOf?: string; key?: string } = {}): SqlFigure {
  const f: SqlFigure = { amount, view, column, tenantId, ...extra };
  assertSqlFigure(f);
  return f;
}

/** "finance_project_summary.overrun" for tooltips and the evidence sheet. */
export function originLabel(f: SqlFigure): string {
  return `${f.view}.${f.column}`;
}

/** Figures shown to a tenant must have been computed for that tenant. */
export function assertTenant(f: SqlFigure, tenantId: string): void {
  if (f.tenantId !== tenantId) throw new SqlOriginError("a figure computed for another tenant cannot be shown here");
}
