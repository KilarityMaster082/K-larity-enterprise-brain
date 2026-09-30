// Owner task: EB-104 Knowledge hub — Visual Knowledge Graph (screen 11): the relationships between projects, vendors,
// drawings, milestones, decisions and subcontracts. Selecting a node lists what it connects to and the evidence behind it.
import type { Metadata } from "next";

import { NoAccess } from "@/components/page/common";
import { Brief, Screen, presenceOf } from "@/components/page/Screen";
import { commsBrief } from "@/lib/briefs";
import { readEvidence } from "@/lib/evidence-access";
import { pageContext } from "@/lib/page";

import { GraphView } from "./GraphView";

export const metadata: Metadata = { title: "Knowledge graph" };

export default async function GraphPage({ searchParams }: { searchParams: Promise<{ node?: string }> }) {
  const ctx = await pageContext("/knowledge/graph", "knowledge.view");
  if (!ctx.allowed) return <NoAccess what="the knowledge graph" />;
  const { node } = await searchParams;
  const { view, session, member } = ctx;
  const g = view.data.workspace.graph;
  // Evidence is re-checked per role before it is attached to a node (finance evidence stays with finance roles).
  const nodes = g.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    kind: n.kind,
    x: n.x,
    y: n.y,
    r: n.r,
    color: `var(--eb-${n.tone})`,
    evidence: n.evidenceIds.map((id) => readEvidence(view, member.role, id)).flatMap((r) => (r.ok ? [r.evidence] : [])),
  }));
  return (
    <Screen n={11} brief={<Brief metrics={commsBrief(view, ctx.can)} live={presenceOf(view.members, session.user)} />}>
      <GraphView nodes={nodes} edges={g.edges} initial={g.nodes.some((n) => n.id === node) ? node : g.nodes[0]?.id} />
    </Screen>
  );
}
