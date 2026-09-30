// Owner task: EB-50 Ask Brain UI — Ask page (screen 1). Shows the first-run strip (EB-94) until the workspace has a
// synced source and a first question; accepts ?q= (from the command palette) and ?project= (scoped ask). The
// Evidence Side-Sheet (screen 2) opens over this page from ?source=.
import type { Metadata } from "next";

import { NoAccess } from "@/components/page/common";
import { Brief, Screen, presenceOf } from "@/components/page/Screen";
import { SUGGESTED_QUESTIONS } from "@/lib/ask/engine";
import { askBrief } from "@/lib/briefs";
import { pageContext } from "@/lib/page";

import { AskScreen } from "./AskScreen";

export const metadata: Metadata = { title: "Ask Brain" };

export default async function AskPage({ searchParams }: { searchParams: Promise<{ q?: string; project?: string }> }) {
  const ctx = await pageContext("/ask", "ask");
  if (!ctx.allowed) return <NoAccess what="Ask Brain" />;
  const { q, project } = await searchParams;
  const { view, member, session } = ctx;
  const scoped = project ? view.data.projects.find((p) => p.projectId === project) : undefined;
  const canFinance = ctx.can("finance.view");
  const suggestions = (view.data.projects.length ? SUGGESTED_QUESTIONS : [])
    .filter((s) => canFinance || !/(budget|overdue|payment)/i.test(s))
    .filter((s) => view.data.projects.some((p) => s.includes(p.name) || !/Phoenix|Marigold/.test(s)));
  return (
    <Screen n={1} brief={<Brief metrics={askBrief(view)} live={presenceOf(view.members, session.user)} />}>
      <AskScreen
        // Re-mount on tenant switch so no answer from the previous workspace stays on screen.
        key={member.tenantId}
        firstName={session.user.name.split(/\s+/)[0] ?? "there"}
        workspace={member.name}
        suggestions={suggestions}
        scope={scoped ? { id: scoped.projectId, name: scoped.name } : undefined}
        initialQuestion={q?.slice(0, 2000)}
        onboarding={view.onboarding}
        syncProgress={view.syncProgress}
        canConnect={ctx.can("sources.manage")}
      />
    </Screen>
  );
}
