// Owner task: EB-55 Financial Brain page — the Finance and Executive screens' numbers, each tagged with the SQL view
// and column that define it (lib/finance-sql.ts). In development the values come from lib/data/derive.ts, which is
// proven equal to db/views/finance.sql by the PostgreSQL equivalence test; with the API connected the same shapes are
// filled from the views themselves. A page never adds, averages or rounds a figure: it renders these.
import { ageing, AGEING_BUCKETS, attentionList, cashMonthly, cashPosition, DEMO_NOW, executiveSummary, leakageFlags, openReceivables, payablesDue, portfolio, projectFinance, type AgeBucket, type AttentionItem } from "./data/derive";
import type { TenantView } from "./data/store";
import { sqlFigure, type SqlFigure } from "./finance-sql";

const asOfDate = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);

export interface ExecutiveFigures {
  asOf: string;
  days: number;
  outstanding: SqlFigure;
  overdue: SqlFigure;
  payablesDue: SqlFigure;
  forecastOverrun: SqlFigure;
  leakage: SqlFigure;
  cashNet: SqlFigure;
}

export function executiveFigures(tenantId: string, view: TenantView, days = 30, now = DEMO_NOW): ExecutiveFigures {
  const s = executiveSummary(view.data, now);
  const payables = payablesDue(view.data, days, now).reduce((a, t) => a + t.amount, 0);
  const asOf = asOfDate(now);
  const f = (column: string, amount: number) => sqlFigure(tenantId, "finance_executive_summary", column, amount, { asOf });
  return {
    asOf,
    days,
    outstanding: f("outstanding", s.outstanding),
    overdue: f("overdue", s.overdue),
    payablesDue: f("payables_due", payables),
    forecastOverrun: f("forecast_overrun", s.forecastOverrun),
    leakage: f("leakage", s.leakage),
    cashNet: f("cash_net", s.cashNet),
  };
}

export function ageingFigures(tenantId: string, view: TenantView, now = DEMO_NOW): { bucket: AgeBucket; figure: SqlFigure }[] {
  const asOf = asOfDate(now);
  const rows = ageing(view.data, now);
  return AGEING_BUCKETS.map((bucket) => ({ bucket, figure: sqlFigure(tenantId, "finance_receivables_ageing", "amount", rows.find((r) => r.bucket === bucket)?.amount ?? 0, { asOf, key: bucket }) }));
}

export interface ProjectFigures {
  projectId: string;
  name: string;
  budget: SqlFigure;
  committed: SqlFigure;
  forecast: SqlFigure;
  overrun: SqlFigure;
  /** Fraction (0.12 = 12%), a ratio of two SQL amounts computed by the view itself. */
  overrunPct: number;
  overdue: SqlFigure;
  outstanding: SqlFigure;
  lines: { package: string; budget: SqlFigure; committed: SqlFigure; overrun: SqlFigure }[];
}

export function projectFigures(tenantId: string, view: TenantView, now = DEMO_NOW): ProjectFigures[] {
  return portfolio(view.data, now).map((r) => {
    const key = r.project.projectId;
    const f = (column: string, amount: number) => sqlFigure(tenantId, "finance_project_summary", column, amount, { key });
    const fin = projectFinance(view.data, key);
    return {
      projectId: key,
      name: r.project.name,
      budget: f("budget", fin.budget),
      committed: f("committed", fin.committed),
      forecast: f("forecast", fin.forecast),
      overrun: f("overrun", fin.overrun),
      overrunPct: fin.overrunPct,
      overdue: f("overdue", fin.overdue),
      outstanding: f("outstanding", fin.outstanding),
      lines: fin.lines.map((l) => {
        const k = `${key}/${l.package}`;
        const g = (column: string, amount: number) => sqlFigure(tenantId, "finance_variance_by_package", column, amount, { key: k });
        return { package: l.package, budget: g("budget", l.budget), committed: g("committed", l.committed), overrun: g("overrun", l.overrun) };
      }),
    };
  });
}

export function cashSeries(tenantId: string, view: TenantView, now = DEMO_NOW): { month: string; cashIn: SqlFigure; cashOut: SqlFigure }[] {
  const asOf = asOfDate(now);
  return cashMonthly(view.data, now).map((m) => ({
    month: m.month,
    cashIn: sqlFigure(tenantId, "finance_cash_monthly", "cash_in", m.cashIn, { asOf, key: m.month }),
    cashOut: sqlFigure(tenantId, "finance_cash_monthly", "cash_out", m.cashOut, { asOf, key: m.month }),
  }));
}

export function cashNet(tenantId: string, view: TenantView, now = DEMO_NOW): SqlFigure {
  return sqlFigure(tenantId, "finance_cash_position", "net", cashPosition(view.data, now).net, { asOf: asOfDate(now) });
}

export function leakageFigures(tenantId: string, view: TenantView) {
  return leakageFlags(view.data).map((f) => ({ ...f, figure: sqlFigure(tenantId, "finance_leakage_flags", "amount", f.amount, { key: f.id }) }));
}

export function receivableFigures(tenantId: string, view: TenantView, now = DEMO_NOW) {
  const asOf = asOfDate(now);
  return openReceivables(view.data, now).map((r) => ({ ...r, figure: sqlFigure(tenantId, "finance_open_receivables", "amount", r.amount, { asOf, key: r.txnId }) }));
}

export function payableFigures(tenantId: string, view: TenantView, days = 30, now = DEMO_NOW) {
  const asOf = asOfDate(now);
  return payablesDue(view.data, days, now).map((t) => ({ ...t, figure: sqlFigure(tenantId, "finance_payables_due", "amount", t.amount, { asOf, key: t.txnId }) }));
}

/**
 * The attention list with its amounts as SQL figures. Only ledger-backed items carry an amount: a cost impact the
 * extractor read out of an email is not a ledger figure (rule 3), so draft decisions are listed without one.
 */
export function attentionFigures(tenantId: string, view: TenantView, limit = 8, now = DEMO_NOW): (AttentionItem & { figure?: SqlFigure })[] {
  const asOf = asOfDate(now);
  return attentionList(view.data, now)
    .slice(0, limit)
    .map((a) => {
      if (a.amount !== undefined && a.id.startsWith("ar-")) return { ...a, figure: sqlFigure(tenantId, "finance_open_receivables", "amount", a.amount, { asOf, key: a.id.slice(3) }) };
      if (a.amount !== undefined && a.id.startsWith("lk-")) return { ...a, figure: sqlFigure(tenantId, "finance_leakage_flags", "amount", a.amount, { key: a.id.slice(3) }) };
      return { ...a, amount: undefined };
    });
}
