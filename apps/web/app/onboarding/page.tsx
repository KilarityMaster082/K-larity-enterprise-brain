// Owner task: EB-94 First-run onboarding and empty-state journeys — Onboarding Wizard (screen 4): welcome, connect
// sources, test and watch the first sync, then seed the first questions. Owners and partners only.
import type { Metadata } from "next";

import { NoAccess } from "@/components/page/common";
import { Screen } from "@/components/page/Screen";
import { SUGGESTED_QUESTIONS } from "@/lib/ask/engine";
import { pageContext } from "@/lib/page";

import { Wizard } from "./Wizard";

export const metadata: Metadata = { title: "Set up your Brain" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const ctx = await pageContext("/onboarding", "onboarding.run");
  if (!ctx.allowed) return <NoAccess what="the setup wizard" />;
  const { step } = await searchParams;
  const { view } = ctx;
  const n = Math.min(3, Math.max(0, Number.parseInt(step ?? "0", 10) || 0));
  const itemsIndexed = view.sources.reduce((a, s) => a + s.itemsSeen, 0);
  return (
    <Screen n={4}>
      <Wizard
        step={n}
        workspace={ctx.member.name}
        sources={view.sources.map((s) => ({ sourceId: s.sourceId, type: s.connectorType, name: s.displayName, account: s.account, health: s.health, itemsSeen: s.itemsSeen, lastError: s.lastError }))}
        syncProgress={view.syncProgress}
        itemsIndexed={itemsIndexed}
        questions={view.hasSyncedSource ? SUGGESTED_QUESTIONS.filter((q) => ctx.can("finance.view") || !/(budget|overdue|payment)/i.test(q)).slice(0, 4) : []}
      />
    </Screen>
  );
}
