// Owner task: EB-23 Web UI shell — every figure the UI shows is derived here from ledger rows, the way the
// reviewed SQL views will derive them (db/views). Pure functions, no I/O, unit-tested in tests/derive.test.ts.
// Pages never add numbers themselves, so Projects, Finance, Executive and Ask cannot disagree.
import type { DocumentItem, FinanceTxn, Project, TenantDataset } from "./types";

/** Fixed "today" for demo data so ageing and overdue counts do not drift. Real data uses the clock. */
export const DEMO_NOW = new Date("2026-09-30T12:00:00+05:30");

const DAY = 864e5;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const daysBetween = (from: string, to: Date) => Math.floor((to.getTime() - new Date(`${from}T00:00:00+05:30`).getTime()) / DAY);

// ---------------------------------------------------------------- project finance
export interface PackageLine {
  package: string;
  budget: number;
  committed: number;
  overrun: number; // max(0, committed − budget)
  txnIds: string[];
}

export interface ProjectFinance {
  projectId: string;
  budget: number;
  committed: number;
  overrun: number;
  forecast: number; // budget + overruns: what the project will cost if nothing else changes
  overrunPct: number;
  lines: PackageLine[];
  billed: number;
  collected: number;
  outstanding: number;
  overdue: number;
}

const isLive = (t: FinanceTxn) => t.status !== "cancelled";

export function projectFinance(ds: TenantDataset, projectId: string): ProjectFinance {
  const project = ds.projects.find((p) => p.projectId === projectId);
  const txns = ds.txns.filter((t) => t.projectId === projectId && isLive(t));
  const lines: PackageLine[] = ds.budgetLines
    .filter((b) => b.projectId === projectId)
    .map((b) => {
      const rows = txns.filter((t) => t.direction === "payable" && t.package === b.package);
      const committed = sum(rows.map((t) => t.amount));
      return { package: b.package, budget: b.budget, committed, overrun: Math.max(0, committed - b.budget), txnIds: rows.map((t) => t.txnId) };
    });
  const budget = project?.budget ?? sum(lines.map((l) => l.budget));
  const overrun = sum(lines.map((l) => l.overrun));
  const receivables = txns.filter((t) => t.direction === "receivable");
  const billed = sum(receivables.map((t) => t.amount));
  const collected = sum(receivables.filter((t) => t.status === "completed").map((t) => t.amount));
  const overdue = sum(receivables.filter((t) => t.status === "overdue").map((t) => t.amount));
  return {
    projectId,
    budget,
    committed: sum(lines.map((l) => l.committed)),
    overrun,
    forecast: budget + overrun,
    overrunPct: budget ? overrun / budget : 0,
    lines,
    billed,
    collected,
    outstanding: billed - collected,
    overdue,
  };
}

// ---------------------------------------------------------------- receivables & payables
export interface Receivable extends FinanceTxn {
  daysOverdue: number; // 0 when not yet due
  bucket: "Not due" | "1–30 days" | "31–60 days" | "60+ days";
}

export function openReceivables(ds: TenantDataset, now = DEMO_NOW): Receivable[] {
  return ds.txns
    .filter((t) => t.direction === "receivable" && (t.status === "pending" || t.status === "overdue"))
    .map((t) => {
      const d = t.dueDate ? Math.max(0, daysBetween(t.dueDate, now)) : 0;
      const bucket: Receivable["bucket"] = d === 0 ? "Not due" : d <= 30 ? "1–30 days" : d <= 60 ? "31–60 days" : "60+ days";
      return { ...t, daysOverdue: d, bucket };
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue || b.amount - a.amount);
}

export const AGEING_BUCKETS: Receivable["bucket"][] = ["Not due", "1–30 days", "31–60 days", "60+ days"];

export function ageing(ds: TenantDataset, now = DEMO_NOW): { bucket: Receivable["bucket"]; amount: number }[] {
  const open = openReceivables(ds, now);
  return AGEING_BUCKETS.map((bucket) => ({ bucket, amount: sum(open.filter((r) => r.bucket === bucket).map((r) => r.amount)) }));
}

export function payablesDue(ds: TenantDataset, withinDays = 30, now = DEMO_NOW): FinanceTxn[] {
  const limit = now.getTime() + withinDays * DAY;
  return ds.txns
    .filter((t) => t.direction === "payable" && t.status === "pending" && t.dueDate && new Date(`${t.dueDate}T00:00:00+05:30`).getTime() <= limit)
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
}

// ---------------------------------------------------------------- leakage flags
export interface LeakageFlag {
  id: string;
  kind: "unsigned_variation" | "cost_not_billed" | "duplicate_invoice";
  title: string;
  detail: string;
  amount: number;
  projectId: string;
  evidenceIds: string[];
}

export function leakageFlags(ds: TenantDataset): LeakageFlag[] {
  const flags: LeakageFlag[] = [];
  // 1. Variations sent but not signed: work proceeds, money is not yet billable.
  for (const d of ds.documents.filter((x: DocumentItem) => x.docType === "contract" && x.signed === false && x.amount)) {
    flags.push({
      id: `unsigned-${d.documentId}`,
      kind: "unsigned_variation",
      title: `${d.title} is unsigned`,
      detail: "The work is under way but the variation cannot be billed until the client signs.",
      amount: d.amount!,
      projectId: d.projectId,
      evidenceIds: [d.evidenceId],
    });
  }
  // 2. Vendor change orders with no matching client variation: cost not passed on.
  for (const co of ds.txns.filter((t) => t.direction === "payable" && t.txnType === "change_order" && isLive(t))) {
    const passedOn = ds.txns.some((t) => t.direction === "receivable" && t.txnType === "change_order" && t.projectId === co.projectId && t.package === co.package);
    if (!passedOn) {
      flags.push({
        id: `unbilled-${co.txnId}`,
        kind: "cost_not_billed",
        title: `Change order ${co.txnRef} not passed to the client`,
        detail: `${co.counterparty} charged a change order for ${co.package ?? "this project"} with no client variation raised.`,
        amount: co.amount,
        projectId: co.projectId,
        evidenceIds: [co.evidenceId],
      });
    }
  }
  // 3. Duplicate vendor invoices: same counterparty, reference and amount.
  const seen = new Map<string, FinanceTxn>();
  for (const t of ds.txns.filter((x) => x.direction === "payable" && isLive(x))) {
    const key = `${t.counterparty}|${t.txnRef}|${t.amount}`;
    const first = seen.get(key);
    if (first) {
      flags.push({
        id: `dup-${t.txnId}`,
        kind: "duplicate_invoice",
        title: `Possible duplicate invoice ${t.txnRef}`,
        detail: `${t.counterparty} invoice ${t.txnRef} appears twice in the ledger (${first.txnDate} and ${t.txnDate}).`,
        amount: t.amount,
        projectId: t.projectId,
        evidenceIds: [first.evidenceId, t.evidenceId],
      });
    } else seen.set(key, t);
  }
  return flags.sort((a, b) => b.amount - a.amount);
}

// ---------------------------------------------------------------- project health
export type Health = "on_track" | "at_risk" | "off_track";

export interface HealthReason {
  text: string;
  evidenceIds: string[];
}

export function projectHealth(ds: TenantDataset, p: Project, now = DEMO_NOW): { health: Health; reasons: HealthReason[] } {
  const fin = projectFinance(ds, p.projectId);
  const reasons: HealthReason[] = [];
  if (fin.overrun > 0) {
    reasons.push({
      text: `Forecast over budget by ${Math.round(fin.overrunPct * 1000) / 10}%`,
      evidenceIds: fin.lines.filter((l) => l.overrun > 0).flatMap((l) => l.txnIds.map((id) => `ev-${id}`)),
    });
  }
  const late = openReceivables(ds, now).filter((r) => r.projectId === p.projectId && r.daysOverdue > 0);
  for (const r of late) reasons.push({ text: `${r.txnRef} is ${r.daysOverdue} days overdue`, evidenceIds: [r.evidenceId] });
  for (const f of leakageFlags(ds).filter((f) => f.projectId === p.projectId && f.kind === "unsigned_variation")) {
    reasons.push({ text: f.title, evidenceIds: f.evidenceIds });
  }
  const health: Health = fin.overrunPct > 0.1 ? "off_track" : reasons.length ? "at_risk" : "on_track";
  return { health, reasons };
}

// ---------------------------------------------------------------- portfolio & executive view
export interface PortfolioRow {
  project: Project;
  finance: ProjectFinance;
  health: Health;
  reasons: HealthReason[];
  openDecisions: number;
}

export function portfolio(ds: TenantDataset, now = DEMO_NOW): PortfolioRow[] {
  return ds.projects.map((project) => {
    const { health, reasons } = projectHealth(ds, project, now);
    return {
      project,
      finance: projectFinance(ds, project.projectId),
      health,
      reasons,
      openDecisions: ds.decisions.filter((d) => d.projectId === project.projectId && d.status === "proposed").length,
    };
  });
}

export interface AttentionItem {
  id: string;
  priority: 1 | 2 | 3;
  title: string;
  detail: string;
  href: string;
  amount?: number;
  evidenceIds: string[];
}

export function attentionList(ds: TenantDataset, now = DEMO_NOW): AttentionItem[] {
  const items: AttentionItem[] = [];
  const name = (id: string) => ds.projects.find((p) => p.projectId === id)?.name ?? id;
  for (const r of openReceivables(ds, now).filter((r) => r.daysOverdue > 0)) {
    items.push({
      id: `ar-${r.txnId}`,
      priority: r.daysOverdue > 30 ? 1 : 2,
      title: `Chase ${r.counterparty}: ${r.txnRef} is ${r.daysOverdue} days overdue`,
      detail: name(r.projectId),
      href: "/finance#receivables",
      amount: r.amount,
      evidenceIds: [r.evidenceId],
    });
  }
  for (const f of leakageFlags(ds)) {
    items.push({ id: `lk-${f.id}`, priority: f.amount >= 500000 ? 1 : 2, title: f.title, detail: name(f.projectId), href: "/finance#leakage", amount: f.amount, evidenceIds: f.evidenceIds });
  }
  for (const d of ds.decisions.filter((d) => d.status === "proposed")) {
    items.push({ id: `dec-${d.decisionId}`, priority: 3, title: `Review draft decision: ${d.title}`, detail: name(d.projectId), href: `/decisions?focus=${d.decisionId}`, amount: d.costImpact, evidenceIds: d.evidenceIds });
  }
  for (const a of ds.approvals.filter((a) => a.status === "pending")) {
    items.push({ id: `apr-${a.approvalId}`, priority: 2, title: `Waiting for approval: ${a.title}`, detail: a.projectId ? name(a.projectId) : "", href: `/approvals?focus=${a.approvalId}`, evidenceIds: a.evidenceIds });
  }
  for (const s of ds.sources.filter((s) => s.health === "auth_error")) {
    items.push({ id: `src-${s.sourceId}`, priority: 2, title: `Reconnect ${s.displayName}: sync has stopped`, detail: s.lastError ?? "", href: "/settings?tab=sources", evidenceIds: [] });
  }
  return items.sort((a, b) => a.priority - b.priority || (b.amount ?? 0) - (a.amount ?? 0));
}

export interface ExecutiveSummary {
  outstanding: number;
  overdue: number;
  payablesDue30: number;
  forecastOverrun: number;
  projectsAtRisk: number;
  projectsOffTrack: number;
  decisionsWaiting: number;
  approvalsPending: number;
  leakage: number;
}

export function executiveSummary(ds: TenantDataset, now = DEMO_NOW): ExecutiveSummary {
  const open = openReceivables(ds, now);
  const rows = portfolio(ds, now);
  return {
    outstanding: sum(open.map((r) => r.amount)),
    overdue: sum(open.filter((r) => r.daysOverdue > 0).map((r) => r.amount)),
    payablesDue30: sum(payablesDue(ds, 30, now).map((t) => t.amount)),
    forecastOverrun: sum(rows.map((r) => r.finance.overrun)),
    projectsAtRisk: rows.filter((r) => r.health === "at_risk").length,
    projectsOffTrack: rows.filter((r) => r.health === "off_track").length,
    decisionsWaiting: ds.decisions.filter((d) => d.status === "proposed").length,
    approvalsPending: ds.approvals.filter((a) => a.status === "pending").length,
    leakage: sum(leakageFlags(ds).map((f) => f.amount)),
  };
}
