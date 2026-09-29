// Owner task: EB-50 Ask Brain UI — Ask page. Shows the first-run checklist (EB-94) until the workspace has a
// synced source and a first question; accepts ?q= (from the command palette) and ?project= (scoped ask).
import type { Metadata } from "next";

import { NoAccess } from "@/components/page/common";
import { SUGGESTED_QUESTIONS } from "@/lib/ask/engine";
import { pageContext } from "@/lib/page";

import { AskScreen } from "./AskScreen";

export const metadata: Metadata = { title: "Ask Brain" };

export default async function AskPage({ searchParams }: { searchParams: Promise<{ q?: string; project?: string }> }) {
  const ctx = await pageContext("/ask", "ask");
  if (!ctx.allowed) return <NoAccess what="Ask Brain" />;
  const { q, project } = await searchParams;
  const { view, member } = ctx;
  const scoped = project ? view.data.projects.find((p) => p.projectId === project) : undefined;
  const canFinance = ctx.can("finance.view");
  const suggestions = (view.data.projects.length ? SUGGESTED_QUESTIONS : [])
    .filter((s) => canFinance || !/(budget|overdue|payment)/i.test(s))
    .filter((s) => view.data.projects.some((p) => s.includes(p.name) || !/Phoenix|Marigold/.test(s)));
  return (
    <div className="content">
      <AskScreen
        // Re-mount on tenant switch so no answer from the previous workspace stays on screen.
        key={member.tenantId}
        workspace={member.name}
        suggestions={suggestions}
        scope={scoped ? { id: scoped.projectId, name: scoped.name } : undefined}
        initialQuestion={q?.slice(0, 2000)}
        onboarding={view.onboarding}
        syncProgress={view.syncProgress}
        canConnect={ctx.can("sources.manage")}
      />
    </div>
  );
}
