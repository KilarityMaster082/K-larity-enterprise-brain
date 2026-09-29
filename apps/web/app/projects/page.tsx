// Owner task: EB-54 Project Brain page — every project at a glance: stage, health (with the reasons), budget
// forecast from the ledger, overdue billing and open decisions.
import { PageHeader } from "@klarity/ui";
import type { Metadata } from "next";

import { NoAccess, NotSyncedYet } from "@/components/page/common";
import { portfolio } from "@/lib/data/derive";
import { pageContext } from "@/lib/page";

import { ProjectsView, type ProjectCard } from "./ProjectsView";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const ctx = await pageContext("/projects", "projects.view");
  if (!ctx.allowed) return <NoAccess what="projects" />;
  const { data } = ctx.view;
  const showMoney = ctx.can("finance.view");
  const cards: ProjectCard[] = portfolio(data).map((r) => ({
    projectId: r.project.projectId,
    name: r.project.name,
    code: r.project.code,
    client: r.project.client,
    location: r.project.location,
    status: r.project.status,
    stages: r.project.stages,
    currentStage: r.project.currentStage,
    health: r.health,
    reasons: r.reasons.map((x) => x.text),
    openDecisions: r.openDecisions,
    money: showMoney ? { budget: r.finance.budget, forecast: r.finance.forecast, overdue: r.finance.overdue } : null,
  }));
  return (
    <div className="content content-wide">
      <PageHeader title="Projects" lead="Stage, health and money for every project — each figure traceable to its source." />
      {cards.length ? <ProjectsView cards={cards} /> : <NotSyncedYet what="projects" />}
    </div>
  );
}
