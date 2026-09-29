// Owner task: EB-60 Executive Brain dashboard — the state of the firm in under two minutes. Owners and partners
// only. Every tile drills down, and every attention item opens its evidence. All figures are derived from the
// same ledger functions as Finance and Projects, so they always agree.
import { Card, formatINRShort, KpiTile, Money, PageHeader, SourceTag } from "@klarity/ui";
import type { Metadata } from "next";
import Link from "next/link";

import { EvidenceLinks } from "@/components/evidence/EvidenceLinks";
import { HealthBadge, NoAccess, NotSyncedYet } from "@/components/page/common";
import { attentionList, executiveSummary, portfolio } from "@/lib/data/derive";
import { evidenceById } from "@/lib/data/store";
import { pageContext } from "@/lib/page";

export const metadata: Metadata = { title: "Executive" };

export default async function ExecutivePage() {
  const ctx = await pageContext("/executive", "executive.view");
  if (!ctx.allowed) return <NoAccess what="the executive view" />;
  const { data } = ctx.view;
  if (!data.projects.length) {
    return (
      <div className="content content-wide">
        <PageHeader title="Executive" lead="The state of the firm in under two minutes." />
        <NotSyncedYet what="projects" />
      </div>
    );
  }
  const s = executiveSummary(data);
  const rows = portfolio(data).sort((a, b) => b.finance.overrunPct - a.finance.overrunPct);
  const attention = attentionList(data).slice(0, 8);
  const risky = rows.filter((r) => r.health !== "on_track");

  return (
    <div className="content content-wide">
      <PageHeader title="Executive" lead="The state of the firm in under two minutes — as of 30 Sep 2026 (demo data)." />
      <div className="stack-lg">
        <div className="kpis kpis-3">
          <KpiTile label="Owed by clients" value={<Money amount={s.outstanding} />} href="/finance#receivables" accent foot={<SourceTag query="finance.open_receivables" />} />
          <KpiTile label="Overdue" value={<Money amount={s.overdue} />} tone={s.overdue ? "danger" : undefined} href="/finance#receivables" foot="Chase these first" />
          <KpiTile label="Forecast overrun" value={<Money amount={s.forecastOverrun} />} tone={s.forecastOverrun ? "danger" : undefined} href="/finance#variance" foot="Across all projects" />
          <KpiTile label="Possible leakage" value={<Money amount={s.leakage} />} href="/finance#leakage" foot="Unsigned, unbilled or duplicated" />
          <KpiTile
            label="Projects needing attention"
            value={s.projectsAtRisk + s.projectsOffTrack}
            href="/projects"
            foot={`${s.projectsOffTrack} off track · ${s.projectsAtRisk} at risk`}
          />
          <KpiTile label="Waiting on you" value={s.decisionsWaiting + s.approvalsPending} href="/approvals" foot={`${s.approvalsPending} approvals · ${s.decisionsWaiting} decisions`} />
        </div>

        <div className="grid-main-side">
          <Card title="Needs your attention today">
            {attention.length ? (
              <ol className="attention" aria-label="Attention list, most urgent first">
                {attention.map((a) => (
                  <li key={a.id}>
                    <span className={`prio prio-${a.priority}`} aria-label={a.priority === 1 ? "Urgent" : a.priority === 2 ? "Soon" : "When you can"} role="img" />
                    <div className="stack-sm" style={{ gap: 4 }}>
                      <span className="attention-title">
                        <Link href={a.href}>{a.title}</Link>
                      </span>
                      {a.detail ? (
                        <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                          {a.detail}
                        </span>
                      ) : null}
                      <EvidenceLinks evidence={evidenceById(ctx.view, a.evidenceIds.slice(0, 3))} citedFor={[a.title]} compact />
                    </div>
                    {a.amount ? <Money amount={a.amount} /> : <span />}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">Nothing needs you today.</p>
            )}
          </Card>

          <Card title="Projects at risk" actions={<Link href="/projects">All projects</Link>}>
            {risky.length ? (
              <ul className="list-plain stack">
                {risky.map((r) => (
                  <li key={r.project.projectId} className="stack-sm" style={{ gap: 4 }}>
                    <div className="row-between">
                      <Link href={`/projects/${r.project.projectId}`} style={{ fontWeight: 650 }}>
                        {r.project.name}
                      </Link>
                      <HealthBadge health={r.health} />
                    </div>
                    <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                      {r.reasons.map((x) => x.text).join(" · ")}
                    </span>
                    {r.finance.overrun > 0 ? (
                      <span style={{ fontSize: "var(--fs-sm)" }}>
                        Forecast {formatINRShort(r.finance.forecast)} against {formatINRShort(r.finance.budget)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">All projects are on track.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
