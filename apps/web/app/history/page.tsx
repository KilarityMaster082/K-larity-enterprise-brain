// Owner task: EB-99 Session history and chat archive — Session History & Chat Archive (screen 40). The signed-in
// person's own past questions, newest first, searchable, each one reopens in Ask Brain (answered again under today's
// permissions, never replayed from a stored answer).
import type { Metadata } from "next";

import { NoAccess } from "@/components/page/common";
import { Brief, Screen, presenceOf } from "@/components/page/Screen";
import { askBrief } from "@/lib/briefs";
import { pageContext } from "@/lib/page";
import { PERIODS, parsePeriod, periodDays } from "@/lib/period";
import { historyStats } from "@/lib/workspace";

import { HistoryView } from "./HistoryView";

export const metadata: Metadata = { title: "Session history" };

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const ctx = await pageContext("/history", "history.view");
  if (!ctx.allowed) return <NoAccess what="Session history" />;
  const { period } = await searchParams;
  const key = parsePeriod(period);
  const days = periodDays(key);
  const { view, session } = ctx;
  const mine = view.data.workspace.history.filter((h) => h.userId === session.user.id).sort((a, b) => b.at.localeCompare(a.at));
  const stats = historyStats({ ...view, data: { ...view.data, workspace: { ...view.data.workspace, history: mine } } }, days);
  const items = mine.slice(0, 200).map((h) => ({ id: h.historyId, at: h.at, question: h.question, topic: h.topic, projectId: h.projectId, helpful: h.helpful }));
  return (
    <Screen n={40} brief={<Brief metrics={askBrief(view)} live={presenceOf(view.members, session.user)} />}>
      <HistoryView
        items={items}
        stats={{ thisPeriod: stats.thisPeriod, previous: stats.previous, helpfulPct: stats.helpfulPct, rated: stats.rated }}
        periodLabel={PERIODS.find((p) => p.key === key)!.label.toLowerCase()}
        canFinance={ctx.can("finance.view")}
      />
    </Screen>
  );
}
