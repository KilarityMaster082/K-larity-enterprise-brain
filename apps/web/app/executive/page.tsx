// Owner task: EB-60 Executive Brain dashboard — Executive Briefing Cockpit (screen 17): the state of the firm in two
// minutes. Owners and partners only. Every money tile is a SqlFigure from db/views/finance.sql (finance_executive_summary,
// finance_cash_monthly); counts come from the same derive functions as Projects and Decisions, so the screens agree.
import { Bento, BentoHead, Grid, LineChart, OriginTag, Pill } from "@klarity/ui";
import type { Metadata } from "next";
import Link from "next/link";

import { EvidenceLinks } from "@/components/evidence/EvidenceLinks";
import { SqlMoney } from "@/components/finance/SqlMoney";
import { HealthBadge, NoAccess, NotSyncedYet } from "@/components/page/common";
import { Brief, Screen, presenceOf } from "@/components/page/Screen";
import { workBrief } from "@/lib/briefs";
import { executiveSummary, openReceivables, portfolio } from "@/lib/data/derive";
import { evidenceById } from "@/lib/data/store";
import { attentionFigures, cashSeries, executiveFigures } from "@/lib/finance-ledger";
import { originLabel } from "@/lib/finance-sql";
import { pageContext } from "@/lib/page";
import { parsePeriod, periodDays } from "@/lib/period";

export const metadata: Metadata = { title: "Executive" };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const greeting = () => {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

export default async function ExecutivePage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const ctx = await pageContext("/executive", "executive.view");
  if (!ctx.allowed) return <NoAccess what="the executive view" />;
  const { period } = await searchParams;
  const days = periodDays(parsePeriod(period));
  const { view, session, member } = ctx;
  const { data } = view;
  const brief = <Brief metrics={workBrief(view, ctx.can)} live={presenceOf(view.members, session.user)} />;
  if (!data.projects.length) {
    return (
      <Screen n={17} brief={brief}>
        <NotSyncedYet what="projects" canConnect={ctx.can("sources.manage")} />
      </Screen>
    );
  }
  const tenantId = member.tenantId;
  const counts = executiveSummary(data);
  const exec = executiveFigures(tenantId, view, days);
  const cash = cashSeries(tenantId, view);
  const rows = portfolio(data).sort((a, b) => b.finance.overrunPct - a.finance.overrunPct);
  const risky = rows.filter((r) => r.health !== "on_track");
  const attention = attentionFigures(tenantId, view, 8);
  const late = openReceivables(data).filter((r) => r.daysOverdue > 0).length;
  const currentMonth = cash[cash.length - 1]!.month;
  const first = session.user.name.split(/\s+/)[0] ?? "there";

  return (
    <Screen n={17} brief={brief}>
      <Grid cols="1.1fr 1fr 1fr" align="stretch">
        <Bento tone="hero" rows={2} pad="lg" fill aria-label="Briefing">
          <h1 className="eb-hero-title">
            {greeting()} {first}, <i>here&apos;s</i> the firm in two minutes.
          </h1>
          <div>
            <p className="eb-body">Net cash collected</p>
            <div className="eb-big"><SqlMoney figure={exec.cashNet} tenantId={tenantId} /></div>
            <p className="eb-note">Completed receivables minus completed payables · <span className="eb-mono">{originLabel(exec.cashNet)}</span></p>
          </div>
        </Bento>
        <Bento tone="lime" fill aria-label="Overdue receivables">
          <BentoHead title="Overdue receivables" />
          <div className="eb-big-md"><SqlMoney figure={exec.overdue} tenantId={tenantId} style="compact" /></div>
          <p className="eb-note">{late} invoice{late === 1 ? "" : "s"} · <Link href="/finance#receivables">chase these first</Link></p>
        </Bento>
        <Bento tone="black" fill aria-label="Projects at risk">
          <BentoHead title="Projects at risk" />
          <div className="eb-big-md eb-lime-text">
            {counts.projectsAtRisk + counts.projectsOffTrack} <span className="eb-note" style={{ display: "inline" }}>of {rows.length}</span>
          </div>
          <p className="eb-note">{counts.projectsOffTrack} off track · {counts.projectsAtRisk} at risk</p>
        </Bento>
        <Bento tone="lavender" fill aria-label="Decisions waiting">
          <BentoHead title="Decisions waiting" />
          <div className="eb-big-md">{counts.decisionsWaiting}</div>
          <p className="eb-note"><Link href="/decisions">Review drafts</Link></p>
        </Bento>
        <Bento tone="pink" fill aria-label="Approvals pending">
          <BentoHead title="Approvals pending" />
          <div className="eb-big-md">{counts.approvalsPending}</div>
          <p className="eb-note"><Link href="/approvals">Open the queue</Link></p>
        </Bento>

        <Bento tone="strong" span={3} aria-label="Cash in and out">
          <BentoHead title="Cash in vs out, last 12 months" aside={<><OriginTag view="finance_cash_monthly" /><span className="eb-note dim">• in &nbsp;┄ out</span></>} />
          <LineChart
            label="Cash received and cash paid per month over the last twelve months"
            series={[
              { name: "in", values: cash.map((m) => m.cashIn.amount), color: "var(--eb-lime-deep)", width: 4 },
              { name: "out", values: cash.map((m) => m.cashOut.amount), color: "#111", dashed: true, width: 1.5 },
            ]}
          />
          <div className="eb-row" style={{ justifyContent: "space-between", marginTop: 4 }}>
            {cash.map((m) => (
              <span key={m.month} className="eb-pill" data-size="sm" data-tone={m.month === currentMonth ? "lime" : "outline"} title={`${m.month}: in ${m.cashIn.amount.toLocaleString("en-IN")}, out ${m.cashOut.amount.toLocaleString("en-IN")}`}>
                {MONTHS[Number(m.month.slice(5)) - 1]}
              </span>
            ))}
          </div>
        </Bento>

        <Bento tone="white" span={3} aria-label="Needs your attention today">
          <BentoHead title="Needs your attention today" />
          {attention.length ? (
            <ol className="eb-list" aria-label="Attention list, most urgent first">
              {attention.map((a) => (
                <li key={a.id} className="eb-li">
                  <span className="eb-dot" style={{ background: a.priority === 1 ? "#b42318" : a.priority === 2 ? "#e0a800" : "#2b8a3e" }} role="img" aria-label={a.priority === 1 ? "Urgent" : a.priority === 2 ? "Soon" : "When you can"} />
                  <div className="eb-grow">
                    <Link className="eb-li-title" href={a.href}>{a.title}</Link>
                    <div className="eb-row" style={{ gap: 6 }}>
                      {a.detail ? <span className="eb-li-sub">{a.detail}</span> : null}
                      <EvidenceLinks evidence={evidenceById(view, a.evidenceIds.slice(0, 3))} citedFor={[a.title]} compact />
                    </div>
                  </div>
                  {a.figure ? <strong><SqlMoney figure={a.figure} tenantId={tenantId} style="compact" /></strong> : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="eb-body">Nothing needs you today.</p>
          )}
        </Bento>

        {risky.length ? (
          <Bento tone="strong" span={3} aria-label="Projects at risk">
            <BentoHead title="Projects at risk" aside={<Link href="/projects">All projects</Link>} />
            <ul className="eb-list">
              {risky.map((r) => (
                <li key={r.project.projectId} className="eb-li">
                  <div className="eb-grow">
                    <Link className="eb-li-title" href={`/projects/${r.project.projectId}`}>{r.project.name}</Link>
                    <div className="eb-li-sub">{r.reasons.map((x) => x.text).join(" · ")}</div>
                  </div>
                  <HealthBadge health={r.health} />
                </li>
              ))}
            </ul>
          </Bento>
        ) : (
          <Bento tone="green" span={3}><p className="eb-body"><Pill tone="lime">All projects are on track</Pill></p></Bento>
        )}
      </Grid>
    </Screen>
  );
}
