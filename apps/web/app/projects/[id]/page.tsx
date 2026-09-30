// Owner task: EB-54 Project Brain page — Project Detail Hub (screen 13): stage timeline, budget vs actual by package
// (partners and owners), drawing revisions, team and contractors, decisions, the event timeline and an Ask box scoped to
// the project.
import { BarRow, Bento, BentoHead, Grid, OriginTag, Pill, PillLink } from "@klarity/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EvidenceLinks } from "@/components/evidence/EvidenceLinks";
import { SqlMoney } from "@/components/finance/SqlMoney";
import { HealthBadge, NoAccess } from "@/components/page/common";
import { Brief, Screen, presenceOf } from "@/components/page/Screen";
import { workBrief } from "@/lib/briefs";
import { projectHealth } from "@/lib/data/derive";
import { evidenceById } from "@/lib/data/store";
import { projectFigures } from "@/lib/finance-ledger";
import { pageContext } from "@/lib/page";
import { formatDate, formatDateTime } from "@klarity/ui/format";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await pageContext(`/projects/${id}`, "projects.view");
  if (!ctx.allowed) return <NoAccess what="projects" />;
  const { view, session, member } = ctx;
  const { data } = view;
  const project = data.projects.find((p) => p.projectId === id);
  if (!project) notFound(); // also what another tenant's project id returns: nothing to see

  const showMoney = ctx.can("finance.view");
  const fig = showMoney ? projectFigures(member.tenantId, view).find((p) => p.projectId === id) : undefined;
  const { health, reasons } = projectHealth(data, project);
  const ev = (ids: string[]) => evidenceById(view, ids);
  const events = data.events.filter((e) => e.projectId === id).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const drawings = data.documents.filter((d) => d.projectId === id && d.docType === "drawing");
  const latest = drawings.filter((d) => d.isLatest);
  const decisions = data.decisions.filter((d) => d.projectId === id && d.status !== "revoked");
  const people = project.peopleIds.map((pid) => data.people.find((p) => p.personId === pid)).filter((p) => p !== undefined);
  const lead = data.people.find((p) => p.personId === project.leadId);
  const maxLine = fig ? Math.max(1, ...fig.lines.map((l) => Math.max(l.budget.amount, l.committed.amount))) : 1;

  return (
    <Screen n={13} brief={<Brief metrics={workBrief(view, ctx.can)} live={presenceOf(view.members, session.user)} />}>
      <div className="eb-stack">
        <Bento tone="sky" aria-label="Milestones">
          <BentoHead title={`${project.name} · milestones`} eyebrow aside={<><HealthBadge health={health} /><span className="eb-note">Stage {project.currentStage + 1} of {project.stages.length}</span></>} />
          <ol className="eb-steps" aria-label="Project stages">
            {project.stages.map((s, i) => (
              <li key={s} aria-current={i === project.currentStage ? "step" : undefined} data-done={i < project.currentStage || undefined}>
                <span className="eb-step-btn">
                  <span className="eb-step-dot" style={{ background: i <= project.currentStage ? "var(--eb-lime)" : "#fff" }} aria-hidden="true" />
                  {s}
                  {i === project.currentStage ? " ●" : ""}
                </span>
              </li>
            ))}
          </ol>
          <p className="eb-note" style={{ marginTop: 8 }}>
            {project.client} · {project.location} · started {formatDate(project.startedOn)} · due {formatDate(project.dueOn)} · lead: {lead?.name ?? "—"}
          </p>
        </Bento>

        <Grid cols="1.3fr 1fr" align="stretch">
          {fig ? (
            <Bento tone="strong" aria-label="Budget versus actual">
              <BentoHead title="Budget vs actual" aside={<OriginTag view="finance_variance_by_package" />} />
              <div style={{ marginTop: 8 }}>
                {fig.lines.map((l) => (
                  <BarRow
                    key={l.package}
                    label={l.package}
                    value={<SqlMoney figure={l.committed} tenantId={member.tenantId} style="compact" />}
                    pct={(l.committed.amount / maxLine) * 100}
                    tone={l.overrun.amount > 0 ? "lime" : "black"}
                    labelWidth={120}
                  />
                ))}
              </div>
              <p className="eb-note" style={{ marginTop: 8 }}>Bars show committed cost; lime means over the package budget.</p>
            </Bento>
          ) : (
            <Bento tone="strong"><p className="eb-body">Budget and billing for this project are visible to partners and owners.</p></Bento>
          )}
          {fig ? (
            <Bento tone="lime" fill aria-label="Forecast">
              <BentoHead title="Forecast" />
              <div className="eb-big"><SqlMoney figure={fig.forecast} tenantId={member.tenantId} /></div>
              <p className="eb-note">
                {fig.overrun.amount > 0 ? <><SqlMoney figure={fig.overrun} tenantId={member.tenantId} /> over </> : "Within "}
                <SqlMoney figure={fig.budget} tenantId={member.tenantId} />
              </p>
            </Bento>
          ) : (
            <Bento tone="lime" fill><BentoHead title="Stage" /><div className="eb-big-md">{project.stages[project.currentStage]}</div></Bento>
          )}
        </Grid>

        {reasons.length ? (
          <Bento tone={health === "off_track" ? "pink" : "cream"} aria-label="Why it needs attention">
            <BentoHead title="Why it needs attention" eyebrow />
            <ul className="eb-list">
              {reasons.map((r) => (
                <li key={r.text} className="eb-li">
                  <span className="eb-grow">{r.text}</span>
                  <EvidenceLinks evidence={ev(r.evidenceIds.slice(0, 3))} citedFor={[r.text]} compact />
                </li>
              ))}
            </ul>
          </Bento>
        ) : null}

        <Grid cols="1fr 1fr 1fr" align="stretch">
          <Bento tone="lavender" aria-label="Drawing revisions">
            <BentoHead title="Drawing revisions" aside={<Link href={`/documents?project=${id}`}>All documents</Link>} />
            {latest.length ? (
              <ul className="eb-list" style={{ marginTop: 6 }}>
                {latest.map((d) => (
                  <li key={d.documentId} className="eb-li" style={{ padding: "5px 0" }}>
                    <Link className="eb-grow" href={`?view=${d.documentId}`} scroll={false}>{d.series} · {d.title}</Link>
                    <Pill tone="black" size="sm">Rev {d.revision}</Pill>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="eb-body">No drawings yet.</p>
            )}
          </Bento>
          <Bento tone="green" aria-label="Team and contractors">
            <BentoHead title="Team & contractors" />
            <div className="eb-row" style={{ marginTop: 8 }}>
              {people.map((p) => (
                <Pill key={p.personId} title={p.org}>{p.name}</Pill>
              ))}
            </div>
          </Bento>
          <Bento tone="black" fill aria-label={`Ask about ${project.name}`}>
            <BentoHead title={`Ask ${project.name.replace(/^Project /, "")}`} />
            <form action="/ask" method="get" className="eb-composer" style={{ background: "#262626" }}>
              <input type="hidden" name="project" value={project.projectId} />
              <label className="visually-hidden" htmlFor="scoped-q">Question about {project.name}</label>
              <textarea id="scoped-q" name="q" rows={1} required placeholder="Ask about this project…" style={{ color: "#eee" }} />
              <button type="submit" className="eb-send" style={{ background: "var(--eb-lime)", color: "#111" }} aria-label="Ask">→</button>
            </form>
          </Bento>
        </Grid>

        <Grid cols="1.2fr 1fr" align="start">
          <Bento tone="strong" aria-label="Timeline">
            <BentoHead title="Timeline" eyebrow />
            {events.length ? (
              <ol className="eb-list" style={{ marginTop: 6 }}>
                {events.map((e) => (
                  <li key={e.eventId} className="eb-li" style={{ alignItems: "flex-start" }}>
                    <span className="eb-mono eb-dim" style={{ width: 92, flex: "none" }}>{formatDateTime(e.occurredAt)}</span>
                    <div className="eb-grow">
                      <span className="eb-li-title">{e.title}</span>
                      {e.description ? <div className="eb-li-sub">{e.description}</div> : null}
                    </div>
                    {e.eventType === "risk" ? <Pill tone="pink" size="sm">Risk</Pill> : null}
                    {e.evidenceId ? <EvidenceLinks evidence={ev([e.evidenceId])} citedFor={[e.title]} compact /> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="eb-body">No events yet.</p>
            )}
          </Bento>
          <Bento tone="strong" aria-label="Decisions">
            <BentoHead title="Decisions" eyebrow aside={<Link href={`/decisions?project=${id}`}>Decision log</Link>} />
            {decisions.length ? (
              <ul className="eb-list" style={{ marginTop: 6 }}>
                {decisions.map((d) => (
                  <li key={d.decisionId} className="eb-li">
                    <Link className="eb-grow eb-li-title" href={`/decisions?focus=${d.decisionId}`}>{d.title}</Link>
                    {d.status === "proposed" ? <Pill tone="cream" size="sm">Draft</Pill> : d.status === "superseded" ? <Pill size="sm">Superseded</Pill> : <Pill tone="lime" size="sm">Decided</Pill>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="eb-body">No decisions recorded.</p>
            )}
            <div style={{ marginTop: 10 }}>
              <PillLink tone="black" size="sm" href={`/ask?project=${id}`}>Ask about this project →</PillLink>
            </div>
          </Bento>
        </Grid>
      </div>
    </Screen>
  );
}
