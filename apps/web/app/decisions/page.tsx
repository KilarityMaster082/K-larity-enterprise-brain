// Owner task: EB-53 Decision Memory with review UI — drafts extracted from messages wait here for a project
// lead or partner to confirm, edit or reject; confirmed decisions form the per-project decision log that
// Ask Brain answers "what did we decide…?" from first.
import { PageHeader } from "@klarity/ui";
import type { Metadata } from "next";

import { NoAccess, NotSyncedYet } from "@/components/page/common";
import { evidenceById } from "@/lib/data/store";
import { pageContext } from "@/lib/page";

import { DecisionsView, type DecisionRow } from "./DecisionsView";

export const metadata: Metadata = { title: "Decisions" };

export default async function DecisionsPage({ searchParams }: { searchParams: Promise<{ focus?: string; project?: string }> }) {
  const ctx = await pageContext("/decisions", "decisions.view");
  if (!ctx.allowed) return <NoAccess what="decisions" />;
  const { focus, project } = await searchParams;
  const { data } = ctx.view;
  const name = (id: string) => data.projects.find((p) => p.projectId === id)?.name ?? id;
  const showMoney = ctx.can("finance.view");
  const rows: DecisionRow[] = data.decisions.map((d) => ({
    ...d,
    costImpact: showMoney ? d.costImpact : undefined,
    projectName: name(d.projectId),
    supersededByTitle: d.supersededBy ? data.decisions.find((x) => x.decisionId === d.supersededBy)?.title : undefined,
    evidence: evidenceById(ctx.view, d.evidenceIds),
  }));
  return (
    <div className="content content-wide">
      <PageHeader
        title="Decisions"
        lead="What was decided, by whom and when — drafted from messages and confirmed by your team before it becomes the record."
      />
      {rows.length ? (
        <DecisionsView
          rows={rows}
          projects={data.projects.map((p) => ({ id: p.projectId, name: p.name }))}
          canReview={ctx.can("decisions.review")}
          focus={focus}
          initialProject={project}
        />
      ) : (
        <NotSyncedYet what="decisions" />
      )}
    </div>
  );
}
