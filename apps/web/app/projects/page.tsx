// Owner task: EB-54 Project Brain page — Projects Fleet Overview (screen 12): every project at a glance: health (with the
// reasons), budget and forecast from the ledger (partners and owners), target date, lead and open risks.
import type { Metadata } from "next";

import { NoAccess, NotSyncedYet } from "@/components/page/common";
import { Brief, Screen, presenceOf } from "@/components/page/Screen";
import { workBrief } from "@/lib/briefs";
import { portfolio } from "@/lib/data/derive";
import { projectFigures } from "@/lib/finance-ledger";
import { pageContext } from "@/lib/page";

import { ProjectsView, type ProjectCard } from "./ProjectsView";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const ctx = await pageContext("/projects", "projects.view");
  if (!ctx.allowed) return <NoAccess what="projects" />;
  const { view, session, member } = ctx;
  const { data } = view;
  const showMoney = ctx.can("finance.view");
  const figures = showMoney ? new Map(projectFigures(member.tenantId, view).map((f) => [f.projectId, f])) : null;
  const leadName = (id: string) => data.people.find((p) => p.personId === id)?.name ?? "—";
  const cards: ProjectCard[] = portfolio(data).map((r) => ({
    projectId: r.project.projectId,
    name: r.project.name,
    code: r.project.code,
    client: r.project.client,
    location: r.project.location,
    stages: r.project.stages,
    currentStage: r.project.currentStage,
    health: r.health,
    reasons: r.reasons.map((x) => x.text),
    openDecisions: r.openDecisions,
    lead: leadName(r.project.leadId),
    dueOn: r.project.dueOn,
    money: figures ? (() => {
      const f = figures.get(r.project.projectId)!;
      return { budget: f.budget, forecast: f.forecast, overrunPct: f.overrunPct };
    })() : null,
  }));
  return (
    <Screen n={12} brief={<Brief metrics={workBrief(view, ctx.can)} live={presenceOf(view.members, session.user)} />}>
      {cards.length ? <ProjectsView cards={cards} tenantId={member.tenantId} /> : <NotSyncedYet what="projects" canConnect={ctx.can("sources.manage")} />}
    </Screen>
  );
}
