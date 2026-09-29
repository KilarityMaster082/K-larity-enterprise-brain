// Owner task: EB-55 Financial Brain page — receivables and ageing, payables due, budget variance by project
// and revenue-leakage flags. Every number is derived from ledger rows (lib/data/derive.ts, later SQL views)
// and drills down to the invoice or document behind it.
import { BarChart, Card, formatINRShort, KpiTile, Money, PageHeader, SourceTag } from "@klarity/ui";
import type { Metadata } from "next";

import { NoAccess, NotSyncedYet } from "@/components/page/common";
import { ageing, executiveSummary, leakageFlags, openReceivables, payablesDue, portfolio } from "@/lib/data/derive";
import { evidenceById } from "@/lib/data/store";
import { pageContext } from "@/lib/page";

import { FinanceTables, type LeakRow, type PayRow, type RecvRow, type VarRow } from "./FinanceTables";

export const metadata: Metadata = { title: "Finance" };

export default async function FinancePage() {
  const ctx = await pageContext("/finance", "finance.view");
  if (!ctx.allowed) return <NoAccess what="finance" />;
  const { data } = ctx.view;
  if (!data.txns.length) {
    return (
      <div className="content content-wide">
        <PageHeader title="Finance" lead="Cash, receivables, budgets and variances — every number from the ledger." />
        <NotSyncedYet what="finance records" />
      </div>
    );
  }
  const name = (id: string) => data.projects.find((p) => p.projectId === id)?.name ?? id;
  const ev = (ids: string[]) => evidenceById(ctx.view, ids);
  const s = executiveSummary(data);

  const recv: RecvRow[] = openReceivables(data).map((r) => ({
    id: r.txnId,
    ref: r.txnRef,
    client: r.counterparty,
    project: name(r.projectId),
    projectId: r.projectId,
    amount: r.amount,
    due: r.dueDate ?? "",
    daysOverdue: r.daysOverdue,
    evidence: ev([r.evidenceId]),
  }));
  const pay: PayRow[] = payablesDue(data, 30).map((t) => ({
    id: t.txnId,
    ref: t.txnRef,
    vendor: t.counterparty,
    project: name(t.projectId),
    pkg: t.package ?? "",
    amount: t.amount,
    due: t.dueDate ?? "",
    evidence: ev([t.evidenceId]),
  }));
  const variance: VarRow[] = portfolio(data).map((r) => ({
    projectId: r.project.projectId,
    project: r.project.name,
    budget: r.finance.budget,
    committed: r.finance.committed,
    forecast: r.finance.forecast,
    overrun: r.finance.overrun,
    overrunPct: r.finance.overrunPct,
  }));
  const leaks: LeakRow[] = leakageFlags(data).map((f) => ({
    id: f.id,
    title: f.title,
    detail: f.detail,
    project: name(f.projectId),
    amount: f.amount,
    kind: f.kind,
    evidence: ev(f.evidenceIds),
  }));

  return (
    <div className="content content-wide">
      <PageHeader title="Finance" lead="Receivables, payables, budget variance and leakage — every number from the ledger, with its source." />
      <div className="stack-lg">
        <div className="kpis kpis-3">
          <KpiTile label="Receivables outstanding" value={<Money amount={s.outstanding} />} foot={<SourceTag query="finance.open_receivables" />} accent />
          <KpiTile
            label="Overdue from clients"
            value={<Money amount={s.overdue} />}
            tone={s.overdue ? "danger" : undefined}
            href="#receivables"
            foot={`${recv.filter((r) => r.daysOverdue > 0).length} invoices past due`}
          />
          <KpiTile label="Payables due in 30 days" value={<Money amount={s.payablesDue30} />} href="#payables" foot={`${pay.length} vendor invoices`} />
          <KpiTile
            label="Forecast overrun"
            value={<Money amount={s.forecastOverrun} />}
            tone={s.forecastOverrun ? "danger" : undefined}
            href="#variance"
            foot={<SourceTag query="finance.variance_by_package" />}
          />
          <KpiTile label="Possible leakage" value={<Money amount={s.leakage} />} href="#leakage" foot={`${leaks.length} flags to check`} />
          <KpiTile label="Cash position" value={<span className="muted">—</span>} foot="Needs the bank feed, which is not connected" />
        </div>

        <Card title="Receivables ageing" id="ageing">
          <BarChart
            label="Open receivables by days overdue"
            data={ageing(data).map((a) => ({ label: a.bucket, value: a.amount, tone: a.bucket === "Not due" ? "ok" : a.bucket === "1–30 days" ? "1" : "danger" }))}
          />
          <p className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 8 }}>
            As of 30 Sep 2026 (demo data). Total {formatINRShort(s.outstanding)}.
          </p>
        </Card>

        <FinanceTables recv={recv} pay={pay} variance={variance} leaks={leaks} />
      </div>
    </div>
  );
}
