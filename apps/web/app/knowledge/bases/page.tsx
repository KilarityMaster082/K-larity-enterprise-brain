// Owner task: EB-104 Knowledge hub — Structured Bases / Data Tables (screen 10): database-style views of the firm's
// structured assets (contractor master, BOQ item catalogue, material rate cards, legal disputes) with filter, sort,
// column choice and CSV export. "Active jobs" is counted from open payables in the ledger, for roles that may see finance.
import type { Metadata } from "next";

import { NoAccess } from "@/components/page/common";
import { Brief, Screen, presenceOf } from "@/components/page/Screen";
import { commsBrief } from "@/lib/briefs";
import { pageContext } from "@/lib/page";
import { contractorJobs } from "@/lib/workspace";

import { BasesView } from "./BasesView";

export const metadata: Metadata = { title: "Structured bases" };

export default async function BasesPage({ searchParams }: { searchParams: Promise<{ base?: string; q?: string }> }) {
  const ctx = await pageContext("/knowledge/bases", "knowledge.view");
  if (!ctx.allowed) return <NoAccess what="structured bases" />;
  const sp = await searchParams;
  const { view, session } = ctx;
  const finance = ctx.can("finance.view");
  const bases = view.data.workspace.bases
    // Rates and approved prices are commercial: only roles that may see finance get those tables.
    .filter((b) => finance || !["b-boq", "b-rates"].includes(b.baseId))
    .map((b) => ({
      ...b,
      rows: b.rows.map((r) => (b.baseId === "b-contractors" ? { ...r, jobs: finance ? contractorJobs(view, String(r["name"])) : "—" } : r)),
    }));
  return (
    <Screen n={10} brief={<Brief metrics={commsBrief(view, ctx.can)} live={presenceOf(view.members, session.user)} />}>
      <BasesView bases={bases} initialBase={sp.base} initialQuery={sp.q} />
    </Screen>
  );
}
