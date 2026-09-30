// Owner task: EB-53 Decision Memory with review UI — Decisions Queue & Log (screen 14), two tiers: drafts the extractor
// found in email and chat wait at the top for a project lead or partner to confirm, edit or reject (each audited);
// confirmed decisions form the chronological log below, with links to their sources. Ask Brain answers "what did we
// decide…?" from the log first.
import type { Metadata } from "next";

import { NoAccess, NotSyncedYet } from "@/components/page/common";
import { Brief, Screen, presenceOf } from "@/components/page/Screen";
import { workBrief } from "@/lib/briefs";
import { evidenceById } from "@/lib/data/store";
import { pageContext } from "@/lib/page";
import { canReviewDraft, triageDrafts } from "@/lib/triage";

import { DecisionsView, type DecisionRow } from "./DecisionsView";

export const metadata: Metadata = { title: "Decisions" };

export default async function DecisionsPage({ searchParams }: { searchParams: Promise<{ focus?: string; project?: string }> }) {
  const ctx = await pageContext("/decisions", "decisions.view");
  if (!ctx.allowed) return <NoAccess what="decisions" />;
  const { focus, project } = await searchParams;
  const { view, session, member } = ctx;
  const { data } = view;
  const name = (id: string) => data.projects.find((p) => p.projectId === id)?.name ?? id;
  const showMoney = ctx.can("finance.view");
  const leadOf = (projectId: string) => {
    const p = data.projects.find((x) => x.projectId === projectId);
    return p ? data.people.find((x) => x.personId === p.leadId)?.name : undefined;
  };
  const rows: DecisionRow[] = data.decisions.map((d) => ({
    ...d,
    costImpact: showMoney ? d.costImpact : undefined,
    projectName: name(d.projectId),
    supersededByTitle: d.supersededBy ? data.decisions.find((x) => x.decisionId === d.supersededBy)?.title : undefined,
    evidence: evidenceById(view, d.evidenceIds),
    canReview: ctx.can("decisions.review") && canReviewDraft(member.role, leadOf(d.projectId), session.user.name),
  }));
  const triage = triageDrafts(rows).map((t) => ({ id: t.decision.decisionId, needsCare: t.needsCare, reasons: t.reasons }));
  return (
    <Screen n={14} brief={<Brief metrics={workBrief(view, ctx.can)} live={presenceOf(view.members, session.user)} />}>
      {rows.length ? (
        <DecisionsView rows={rows} triage={triage} projects={data.projects.map((p) => ({ id: p.projectId, name: p.name }))} focus={focus} initialProject={project} />
      ) : (
        <NotSyncedYet what="decisions" canConnect={ctx.can("sources.manage")} />
      )}
    </Screen>
  );
}
