// Owner task: EB-55 Financial Brain page — Finance & Cash Control (screen 16). Owners and partners only. Receivables
// ageing, what clients owe, package overruns and margin-leakage flags, in lakh/crore notation. Every figure is a
// SqlFigure from the reviewed views in db/views/finance.sql (lib/finance-sql.ts) and drills down to the ledger row.
import { BarRow, Bento, BentoHead, Columns, Grid, OriginTag, Pill, formatLakhNumber } from "@klarity/ui";
import type { Metadata } from "next";

import { SqlMoney } from "@/components/finance/SqlMoney";
import { NoAccess, NotSyncedYet } from "@/components/page/common";
import { Brief, Screen, presenceOf } from "@/components/page/Screen";
import { workBrief } from "@/lib/briefs";
import { openReceivables } from "@/lib/data/derive";
import { evidenceById } from "@/lib/data/store";
import { ageingFigures, executiveFigures, leakageFigures, payableFigures, projectFigures, receivableFigures } from "@/lib/finance-ledger";
import { originLabel } from "@/lib/finance-sql";
import { pageContext } from "@/lib/page";
import { PERIODS, parsePeriod, periodDays } from "@/lib/period";

import { FinanceTables } from "./FinanceTables";

export const metadata: Metadata = { title: "Finance" };

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const ctx = await pageContext("/finance", "finance.view");
  if (!ctx.allowed) return <NoAccess what="finance" />;
  const { period } = await searchParams;
  const key = parsePeriod(period);
  const days = periodDays(key);
  const { view, session, member } = ctx;
  const tenantId = member.tenantId;
  const brief = <Brief metrics={workBrief(view, ctx.can)} live={presenceOf(view.members, session.user)} />;
  if (!view.data.txns.length) {
    return (
      <Screen n={16} brief={brief}>
        <NotSyncedYet what="finance records" canConnect={ctx.can("sources.manage")} />
      </Screen>
    );
  }
  const data = view.data;
  const name = (id: string) => data.projects.find((p) => p.projectId === id)?.name ?? id;
  const ev = (ids: string[]) => evidenceById(view, ids);

  const exec = executiveFigures(tenantId, view, days);
  const ageing = ageingFigures(tenantId, view);
  const projects = projectFigures(tenantId, view);
  const leaks = leakageFigures(tenantId, view);
  const maxAge = Math.max(1, ...ageing.map((a) => a.figure.amount));
  const AGE_COLORS = ["var(--eb-black)", "var(--eb-lime)", "var(--eb-lavender)", "var(--eb-pink)"];
  const overruns = projects
    .flatMap((p) => p.lines.filter((l) => l.overrun.amount > 0).map((l) => ({ label: l.package, project: p.name, fig: l.overrun })))
    .sort((a, b) => b.fig.amount - a.fig.amount)
    .slice(0, 4);
  const maxOver = Math.max(1, ...overruns.map((o) => o.fig.amount));
  const lateCount = openReceivables(data).filter((r) => r.daysOverdue > 0).length;
  const payWindow = days <= 1 ? "today" : days <= 7 ? "this week" : days <= 30 ? "in the next 30 days" : "in the next 12 months";

  return (
    <Screen n={16} brief={brief}>
      <div className="eb-stack">
        <Grid cols="repeat(4, minmax(0, 1fr))" align="stretch">
          <Bento tone="strong" span={2} aria-label="Receivables ageing">
            <BentoHead title="Receivables ageing" aside={<span className="eb-note dim">₹ lakh · by invoice age</span>} />
            <Columns
              label="Open receivables by invoice age, in lakh of rupees"
              data={ageing.map((a, i) => ({ label: a.bucket, value: formatLakhNumber(a.figure.amount), pct: (a.figure.amount / maxAge) * 100, color: AGE_COLORS[i]! }))}
            />
          </Bento>
          <Bento tone="lime" fill aria-label="Owed by clients">
            <BentoHead title="Owed by clients" />
            <div className="eb-big"><SqlMoney figure={exec.outstanding} tenantId={tenantId} /></div>
            <p className="eb-note"><span className="eb-mono">{originLabel(exec.outstanding)}</span></p>
          </Bento>
          <Bento tone="black" fill aria-label="Overdue">
            <BentoHead title="Overdue" />
            <div className="eb-big-md eb-lime-text"><SqlMoney figure={exec.overdue} tenantId={tenantId} style="compact" /></div>
            <p className="eb-note">{lateCount ? `${lateCount} invoice${lateCount > 1 ? "s" : ""} — chase these first` : "Nothing overdue"}</p>
          </Bento>
          <Bento tone="pink" span={2} aria-label="Package overruns">
            <BentoHead title="Package overruns" eyebrow aside={<OriginTag view="finance_variance_by_package" />} />
            {overruns.length ? (
              overruns.map((o) => (
                <BarRow key={`${o.project}-${o.label}`} label={`${o.label} · ${o.project.replace("Project ", "")}`} value={<>+<SqlMoney figure={o.fig} tenantId={tenantId} style="compact" /></>} pct={(o.fig.amount / maxOver) * 100} tone="black" labelWidth={150} />
              ))
            ) : (
              <p className="eb-body">No package is over its budget.</p>
            )}
          </Bento>
          <Bento tone="cream" span={2} aria-label="Margin leakage flags">
            <BentoHead title="Margin leakage flags" eyebrow aside={<OriginTag view="finance_leakage_flags" />} />
            <div className="eb-row" style={{ marginTop: 10 }}>
              {leaks.length ? (
                leaks.map((l) => (
                  <Pill key={l.id} title={l.detail}>
                    {l.kind === "unsigned_variation" ? "Unsigned change order" : l.kind === "cost_not_billed" ? "Unbilled cost" : "Duplicate invoice"} <SqlMoney figure={l.figure} tenantId={tenantId} style="compact" />
                  </Pill>
                ))
              ) : (
                <p className="eb-body">No leakage flags.</p>
              )}
            </div>
            <p className="eb-note" style={{ marginTop: 8 }}>
              Total at stake <SqlMoney figure={exec.leakage} tenantId={tenantId} /> · {PERIODS.find((p) => p.key === key)!.label.toLowerCase()} window for payables
            </p>
          </Bento>
        </Grid>

        <FinanceTables
          tenantId={tenantId}
          payWindow={payWindow}
          recv={receivableFigures(tenantId, view).map((r) => ({ id: r.txnId, ref: r.txnRef, client: r.counterparty, project: name(r.projectId), projectId: r.projectId, amount: r.figure, due: r.dueDate ?? "", daysOverdue: r.daysOverdue, ageDays: r.ageDays, evidence: ev([r.evidenceId]) }))}
          pay={payableFigures(tenantId, view, days).map((t) => ({ id: t.txnId, ref: t.txnRef, vendor: t.counterparty, project: name(t.projectId), pkg: t.package ?? "", amount: t.figure, due: t.dueDate ?? "", evidence: ev([t.evidenceId]) }))}
          variance={projects.map((p) => ({ projectId: p.projectId, project: p.name, budget: p.budget, committed: p.committed, forecast: p.forecast, overrun: p.overrun, overrunPct: p.overrunPct }))}
          leaks={leaks.map((f) => ({ id: f.id, title: f.title, detail: f.detail, project: name(f.projectId), amount: f.figure, kind: f.kind, evidence: ev(f.evidenceIds) }))}
        />
      </div>
    </Screen>
  );
}
