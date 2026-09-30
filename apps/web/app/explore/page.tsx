// Owner task: EB-100 Suggested topics and trends — Suggested Topics & Trends (screen 41). Insight cards computed from
// the tenant's ledger, documents, mail and events (lib/workspace.ts), and the wedge chart of how many open items each
// kind has. Every card opens an Ask Brain question that returns the evidence.
import { Bento, Grid, PillLink, WedgeChart } from "@klarity/ui";
import type { Metadata } from "next";

import { NoAccess } from "@/components/page/common";
import { Brief, Screen, presenceOf } from "@/components/page/Screen";
import { askBrief } from "@/lib/briefs";
import { pageContext } from "@/lib/page";
import { topicCards, wedgeCounts } from "@/lib/workspace";

export const metadata: Metadata = { title: "Explore" };

export default async function ExplorePage() {
  const ctx = await pageContext("/explore", "explore.view");
  if (!ctx.allowed) return <NoAccess what="Suggested topics" />;
  const { view, session } = ctx;
  const cards = topicCards(view, ctx.can);
  const wedges = wedgeCounts(view, ctx.can);
  const empty = wedges.every((w) => w.value === 0);
  return (
    <Screen n={41} brief={<Brief metrics={askBrief(view)} live={presenceOf(view.members, session.user)} />}>
      <Grid cols="1fr 1fr" align="start">
        <Bento tone="graphite" pad="lg" aria-label="Open items by kind">
          <h2 className="eb-eyebrow" style={{ marginBottom: 8 }}>Open items by kind</h2>
          {empty ? <p className="eb-body">Nothing to chart yet. Connect a source to see where the firm's time goes.</p> : <WedgeChart items={wedges} label="Number of open items for each kind of issue" />}
        </Bento>
        <div className="eb-stack">
        {cards.length ? (
          cards.map((c) => (
            <Bento key={c.id} tone={c.tone} aria-label={c.kind}>
              <h2 className="eb-eyebrow">{c.kind}</h2>
              <p className="eb-h-lg" style={{ marginTop: 8, lineHeight: 1.25 }}>{c.headline}</p>
              <p className="eb-body" style={{ marginTop: 6 }}>{c.detail}</p>
              <div style={{ marginTop: 8 }}>
                <PillLink tone="black" size="sm" href={`/ask?q=${encodeURIComponent(c.ask)}`}>
                  Ask the Brain →
                </PillLink>
              </div>
            </Bento>
          ))
        ) : (
          <Bento tone="cream">
            <h2 className="eb-h">No topics yet</h2>
            <p className="eb-body">Topics appear when sources are synced and the Brain finds cost movements, revision churn or late payments.</p>
          </Bento>
        )}
        </div>
      </Grid>
    </Screen>
  );
}
