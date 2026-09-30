// Owner task: EB-106 Agents and background jobs — Space Pinned Files (screen 28): the documents pinned to a channel, and
// the background agent runs that worked for it. A file opens in the viewer over this page (?view=).
import { Bento, BentoHead, Pill, formatDate } from "@klarity/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OverlayButton } from "@/components/overlays/OverlayButton";
import { NoAccess } from "@/components/page/common";
import { Brief, Screen, presenceOf } from "@/components/page/Screen";
import { agentsBrief } from "@/lib/briefs";
import { pageContext } from "@/lib/page";

export const metadata: Metadata = { title: "Space files" };

export default async function SpaceFilesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await pageContext(`/spaces/${id}/files`, "spaces.view");
  if (!ctx.allowed) return <NoAccess what="spaces" />;
  const { view, session } = ctx;
  const space = view.data.workspace.spaces.find((s) => s.spaceId === id);
  if (!space) notFound();
  const docs = space.pinnedDocumentIds.map((d) => view.data.documents.find((x) => x.documentId === d)).filter((d) => d !== undefined);
  const canRuns = ctx.can("agents.view");
  const runs = canRuns ? view.data.workspace.jobs.flatMap((j) => j.runs.map((r) => ({ job: j.name, run: r }))).slice(0, space.agentRuns) : [];
  return (
    <Screen n={28} brief={<Brief metrics={agentsBrief(view)} live={presenceOf(view.members, session.user)} />}>
      <Bento tone="strong" aria-label="Pinned files">
        <BentoHead title={`# ${space.name} · pinned files`} aside={<Link href={`/spaces/${space.spaceId}`} className="eb-pill" data-size="sm">Discussion</Link>} />
        {docs.length === 0 ? <p className="eb-body">Nothing is pinned to this space.</p> : (
          <ul className="eb-list" aria-label="Pinned files">
            {docs.map((d) => (
              <li key={d.documentId} className="eb-li">
                <div className="eb-grow"><span className="eb-li-title">{d.title}</span><div className="eb-li-sub">{d.fileName ?? d.docType} · updated {formatDate(d.updatedAt)}</div></div>
                {d.series ? <Pill size="sm" tone="outline">{d.series}{d.revision ? ` Rev ${d.revision}` : ""}</Pill> : null}
                <OverlayButton name="view" value={d.documentId} size="sm" tone="black">Open</OverlayButton>
              </li>
            ))}
          </ul>
        )}
      </Bento>
      {canRuns ? (
        <Bento tone="lavender" aria-label="Agent runs" style={{ marginTop: 12 }}>
          <BentoHead title="Agent runs for this space" />
          {runs.length === 0 ? <p className="eb-body">No background agent has worked for this space.</p> : (
            <ul className="eb-list">
              {runs.map(({ job, run }) => (
                <li key={run.runId} className="eb-li">
                  <span className="eb-li-title eb-grow">{job}</span>
                  <Pill size="sm">{run.status}</Pill>
                  <OverlayButton name="run" value={run.runId} size="sm" tone="outline">Inspect</OverlayButton>
                </li>
              ))}
            </ul>
          )}
        </Bento>
      ) : null}
    </Screen>
  );
}
