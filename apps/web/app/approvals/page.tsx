// Owner task: EB-66 Approval model skeleton (UI) — nothing leaves K!larity without a person approving it
// (CLAUDE.md rule 10). Drafts from Ask Brain and agents wait here with the evidence behind them.
import { PageHeader } from "@klarity/ui";
import type { Metadata } from "next";

import { NoAccess } from "@/components/page/common";
import { evidenceById } from "@/lib/data/store";
import { pageContext } from "@/lib/page";

import { ApprovalsView, type ApprovalRow } from "./ApprovalsView";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const ctx = await pageContext("/approvals", "approvals.view");
  if (!ctx.allowed) return <NoAccess what="approvals" />;
  const { focus } = await searchParams;
  const { data } = ctx.view;
  const name = (id?: string) => (id ? data.projects.find((p) => p.projectId === id)?.name : undefined);
  const rows: ApprovalRow[] = ctx.view.approvals
    .map((a) => ({ ...a, projectName: name(a.projectId), evidence: evidenceById(ctx.view, a.evidenceIds) }))
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  return (
    <div className="content content-wide">
      <PageHeader title="Approvals" lead="Drafted messages and tasks wait here until someone with the right role approves them. Every choice is audited." />
      <ApprovalsView rows={rows} canDecide={ctx.can("approvals.decide")} focus={focus} />
    </div>
  );
}
