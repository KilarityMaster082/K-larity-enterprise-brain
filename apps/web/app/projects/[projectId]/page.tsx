// Owner task: EB-54 Project Brain page — one page per project: stage, health and why, money from the ledger
// (partners only), timeline of events, latest drawings, decisions, people and an Ask box scoped to it.
import {
  Badge,
  Card,
  formatDate,
  formatDateTime,
  formatINRShort,
  formatPercent,
  Icon,
  KpiTile,
  Money,
  PageHeader,
  SourceTag,
  Stepper,
  Timeline,
} from "@klarity/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EvidenceLinks } from "@/components/evidence/EvidenceLinks";
import { HealthBadge, NoAccess } from "@/components/page/common";
import { projectFinance, projectHealth, type PackageLine } from "@/lib/data/derive";
import { evidenceById } from "@/lib/data/store";
import type { ProjectEvent } from "@/lib/data/types";
import { pageContext } from "@/lib/page";

import { PackageTable } from "./PackageTable";

export const metadata: Metadata = { title: "Project" };

const EVENT_ICON: Record<ProjectEvent["eventType"], "chat" | "mail" | "drawing" | "decisions" | "finance" | "building" | "alert"> = {
  message: "chat",
  email: "mail",
  drawing: "drawing",
  decision: "decisions",
  invoice: "finance",
  payment: "finance",
  site: "building",
  risk: "alert",
};

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const ctx = await pageContext(`/projects/${projectId}`, "projects.view");
  if (!ctx.allowed) return <NoAccess what="projects" />;
  const { data } = ctx.view;
  const project = data.projects.find((p) => p.projectId === projectId);
  if (!project) notFound(); // also what another tenant's project id returns: nothing to see

  const showMoney = ctx.can("finance.view");
  const fin = projectFinance(data, projectId);
  const { health, reasons } = projectHealth(data, project);
  const ev = (ids: string[]) => evidenceById(ctx.view, ids);
  const events = data.events.filter((e) => e.projectId === projectId).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const drawings = data.documents.filter((d) => d.projectId === projectId && d.docType === "drawing" && d.isLatest);
  const decisions = data.decisions.filter((d) => d.projectId === projectId && d.status !== "revoked");
  const people = project.peopleIds.map((id) => data.people.find((p) => p.personId === id)).filter((p) => p !== undefined);
  const lead = data.people.find((p) => p.personId === project.leadId);

  return (
    <div className="content content-wide">
      <PageHeader
        crumbs={
          <>
            <Link href="/projects">Projects</Link> <span aria-hidden="true">/</span> <span>{project.code}</span>
          </>
        }
        title={project.name}
        lead={`${project.client} · ${project.location} · ${project.description}`}
        actions={<HealthBadge health={health} />}
      />

      <div className="stack-lg">
        <Card title="Stage">
          <div className="stack-sm">
            <Stepper steps={project.stages} current={project.currentStage} label={`Stage: ${project.stages[project.currentStage]}`} />
            <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>
              Started {formatDate(project.startedOn)} · due {formatDate(project.dueOn)} · lead: {lead?.name ?? "—"}
            </p>
          </div>
        </Card>

        {reasons.length ? (
          <Card title="Why it needs attention">
            <ul className="list-plain stack-sm">
              {reasons.map((r) => (
                <li key={r.text} className="row-between">
                  <span>
                    <Icon name="alert" size={14} /> {r.text}
                  </span>
                  <EvidenceLinks evidence={ev(r.evidenceIds.slice(0, 3))} citedFor={[r.text]} compact />
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {showMoney ? (
          <section aria-labelledby="money-title" className="stack">
            <h2 id="money-title" className="section-title">
              Money (from the finance ledger)
            </h2>
            <div className="kpis">
              <KpiTile label="Approved budget" value={<Money amount={fin.budget} />} foot={<SourceTag query="finance.project_budget" />} />
              <KpiTile
                label="Forecast at completion"
                value={<Money amount={fin.forecast} />}
                tone={fin.overrun > 0 ? "danger" : undefined}
                accent
                foot={
                  <>
                    {fin.overrun > 0 ? `+${formatINRShort(fin.overrun)} (${formatPercent(fin.overrunPct)}) over` : "Within budget"}
                    <SourceTag query="finance.variance_by_package" />
                  </>
                }
              />
              <KpiTile label="Billed to client" value={<Money amount={fin.billed} />} foot={`Collected ${formatINRShort(fin.collected)}`} />
              <KpiTile
                label="Outstanding from client"
                value={<Money amount={fin.outstanding} />}
                tone={fin.overdue > 0 ? "danger" : undefined}
                foot={fin.overdue > 0 ? `${formatINRShort(fin.overdue)} overdue` : "Nothing overdue"}
              />
            </div>
            <Card title="Budget vs committed, by package">
              <PackageTable lines={fin.lines} evidence={Object.fromEntries(fin.lines.map((l: PackageLine) => [l.package, ev(l.txnIds.map((t) => `ev-${t}`))]))} />
            </Card>
          </section>
        ) : (
          <p className="note note-info">Budget and billing for this project are visible to partners and owners.</p>
        )}

        <div className="grid-main-side">
          <Card title="Timeline">
            {events.length ? (
              <Timeline
                label={`${project.name} timeline`}
                items={events.map((e) => ({
                  id: e.eventId,
                  when: formatDateTime(e.occurredAt),
                  title: e.title,
                  description: e.description,
                  icon: EVENT_ICON[e.eventType],
                  tone: e.eventType === "risk" ? "danger" : e.eventType === "decision" ? "brand" : undefined,
                  extra: e.evidenceId ? <EvidenceLinks evidence={ev([e.evidenceId])} citedFor={[e.title]} compact /> : undefined,
                }))}
              />
            ) : (
              <p className="muted">No events yet.</p>
            )}
          </Card>

          <div className="stack">
            <Card title="Ask about this project">
              <form action="/ask" method="get" className="stack-sm">
                <input type="hidden" name="project" value={project.projectId} />
                <label className="visually-hidden" htmlFor="scoped-q">
                  Question about {project.name}
                </label>
                <textarea id="scoped-q" name="q" className="textarea" rows={2} placeholder={`e.g. Why is ${project.name} over budget?`} required />
                <button type="submit" className="btn btn-primary">
                  <Icon name="ask" size={16} /> Ask
                </button>
              </form>
            </Card>

            <Card title="Latest drawings" actions={<Link href={`/documents?project=${project.projectId}`}>All documents</Link>}>
              {drawings.length ? (
                <ul className="list-plain stack-sm">
                  {drawings.map((d) => (
                    <li key={d.documentId} className="row-between">
                      <Link href={`/documents?doc=${d.documentId}`}>
                        {d.series} · {d.title}
                      </Link>
                      <Badge tone="solid">Rev {d.revision}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No drawings yet.</p>
              )}
            </Card>

            <Card title="Decisions" actions={<Link href={`/decisions?project=${project.projectId}`}>Decision log</Link>}>
              {decisions.length ? (
                <ul className="list-plain stack-sm">
                  {decisions.map((d) => (
                    <li key={d.decisionId} className="stack-sm" style={{ gap: 2 }}>
                      <Link href={`/decisions?focus=${d.decisionId}`}>{d.title}</Link>
                      <span className="row">
                        {d.status === "proposed" ? <Badge tone="info">Draft — needs review</Badge> : null}
                        {d.status === "superseded" ? <Badge>Superseded</Badge> : null}
                        {d.status === "decided" ? <Badge tone="ok">Decided</Badge> : null}
                        {showMoney && d.costImpact ? <Money amount={d.costImpact} /> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No decisions recorded.</p>
              )}
            </Card>

            <Card title="People">
              <ul className="list-plain stack-sm">
                {people.map((p) => (
                  <li key={p.personId} className="row-between">
                    <span>{p.name}</span>
                    <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                      {p.org}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

