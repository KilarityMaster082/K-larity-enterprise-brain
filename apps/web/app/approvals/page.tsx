// Owner task: EB-66 Approval model skeleton (UI) — Action Approvals Queue (screen 18): nothing leaves K!larity without a
// person approving it (CLAUDE.md rule 10). Drafts from Ask Brain and agents wait here with the evidence behind them;
// rejecting needs a reason; every choice is audited.
import type { Metadata } from "next";

import { NoAccess } from "@/components/page/common";
import { Brief, Screen, presenceOf } from "@/components/page/Screen";
import { workBrief } from "@/lib/briefs";
import { evidenceById } from "@/lib/data/store";
import { pageContext } from "@/lib/page";

import { ApprovalsView, type ApprovalRow } from "./ApprovalsView";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const ctx = await pageContext("/approvals", "approvals.view");
  if (!ctx.allowed) return <NoAccess what="approvals" />;
  const { focus } = await searchParams;
  const { view, session } = ctx;
  const { data } = view;
  const name = (id?: string) => (id ? data.projects.find((p) => p.projectId === id)?.name : undefined);
  const rows: ApprovalRow[] = view.approvals
    .map((a) => ({ ...a, projectName: name(a.projectId), evidence: evidenceById(view, a.evidenceIds) }))
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  return (
    <Screen n={18} brief={<Brief metrics={workBrief(view, ctx.can)} live={presenceOf(view.members, session.user)} />}>
      <ApprovalsView rows={rows} canDecide={ctx.can("approvals.decide")} focus={focus} />
    </Screen>
  );
}
