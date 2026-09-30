// Owner task: EB-104 Knowledge hub — Knowledge Hub (screen 8): the three ways into the firm's knowledge (graph, structured
// bases, file vault), how much is indexed, how healthy the pipeline is and a search across everything the role may see.
// Set sizes are counted from the connected sources; chunk and storage totals come from the index service.
import { Bento, BentoHead, Dot, Grid, PillLink, formatNumber, ProgressTrack } from "@klarity/ui";
import type { Metadata } from "next";
import Link from "next/link";

import { NoAccess } from "@/components/page/common";
import { Brief, Screen, presenceOf } from "@/components/page/Screen";
import { commsBrief } from "@/lib/briefs";
import { pageContext } from "@/lib/page";
import { knowledgeSearch, knowledgeSets } from "@/lib/workspace";

export const metadata: Metadata = { title: "Knowledge" };

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await pageContext("/knowledge", "knowledge.view");
  if (!ctx.allowed) return <NoAccess what="the knowledge hub" />;
  const { q } = await searchParams;
  const { view, session } = ctx;
  const k = view.data.workspace.knowledge;
  const sets = knowledgeSets(view);
  const hits = knowledgeSearch(view, ctx.can, q ?? "");
  const storagePct = k.storageCapGb ? (k.storageGb / k.storageCapGb) * 100 : 0;
  return (
    <Screen n={8} brief={<Brief metrics={commsBrief(view, ctx.can)} live={presenceOf(view.members, session.user)} />}>
      <Grid cols="repeat(4, minmax(0, 1fr))" align="stretch">
        <div className="eb-row" style={{ gridColumn: "span 4" }} aria-label="Knowledge views">
          <PillLink tone="black" href="/knowledge/graph">Graph View</PillLink>
          <PillLink href="/knowledge/bases">Structured Bases</PillLink>
          <PillLink href="/knowledge/files">File Vault</PillLink>
        </div>
        <Bento tone="lime" span={2} fill aria-label="Indexed chunks">
          <BentoHead title="Indexed chunks" />
          <div className="eb-big eb-num">{formatNumber(k.chunks)}</div>
          <p className="eb-note">{formatNumber(k.chunksDeltaMonth)} more than last month</p>
        </Bento>
        <Bento tone="black" fill aria-label="Storage">
          <BentoHead title="Storage" />
          <div className="eb-big-md">{k.storageGb} GB</div>
          <ProgressTrack pct={storagePct} dark label={`Storage used: ${k.storageGb} of ${k.storageCapGb} GB`} />
        </Bento>
        <Bento tone="green" aria-label="Pipeline health">
          <BentoHead title="Pipeline health" />
          <ul className="eb-stack tight" style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
            {k.pipeline.map((p) => (
              <li key={p.stage} className="eb-row" style={{ gap: 8 }}>
                <Dot ink large label={p.health === "ok" ? "Healthy" : p.health} /> {p.stage}
              </li>
            ))}
          </ul>
        </Bento>
        <Bento tone="strong" span={4} aria-label="Search">
          <form action="/knowledge" role="search" className="eb-search">
            <label className="visually-hidden" htmlFor="kq">Search across all firm archives</label>
            <input id="kq" name="q" type="search" defaultValue={q} placeholder="Search across all firm archives…" />
          </form>
          {q && q.trim().length >= 2 ? (
            hits.length ? (
              <ul className="eb-list" style={{ marginTop: 8 }} aria-label="Search results">
                {hits.map((h, i) => (
                  <li key={`${h.kind}-${i}`}>
                    <Link href={h.href} className="eb-li">
                      <span className="eb-pill" data-size="sm" data-tone="outline">{h.kind}</span>
                      <span className="eb-li-title eb-grow eb-trunc">{h.label}</span>
                      <span className="eb-li-sub">{h.sub}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="eb-body" role="status" style={{ marginTop: 8 }}>Nothing matches “{q}”.</p>
            )
          ) : null}
        </Bento>
        {sets.map((s) => (
          <Bento key={s.name} tone={s.tone} fill style={{ minHeight: 70 }}>
            <BentoHead title={s.name} />
            <div className="eb-big-md eb-num">{formatNumber(s.count)}</div>
          </Bento>
        ))}
      </Grid>
    </Screen>
  );
}
