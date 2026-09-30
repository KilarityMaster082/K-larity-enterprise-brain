// Owner task: EB-106 Agents and background jobs — Space Discussion Feed (screen 27): the channel's messages with @mentions,
// reactions, threaded replies and the files they point at. Posting and reacting are audited; viewers can only read.
import { Bento, BentoHead, Pill } from "@klarity/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { NoAccess } from "@/components/page/common";
import { Brief, Screen, presenceOf } from "@/components/page/Screen";
import { agentsBrief } from "@/lib/briefs";
import { pageContext } from "@/lib/page";
import { projectName } from "@/lib/workspace";

import { Feed } from "./Feed";

export const metadata: Metadata = { title: "Space" };

export default async function SpacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await pageContext(`/spaces/${id}`, "spaces.view");
  if (!ctx.allowed) return <NoAccess what="spaces" />;
  const { view, session } = ctx;
  const space = view.data.workspace.spaces.find((s) => s.spaceId === id);
  if (!space) notFound(); // another tenant's space looks exactly like a missing one
  const docs = new Map(view.data.documents.map((d) => [d.documentId, d]));
  const messages = space.messages.map((m) => ({ ...m, document: m.documentId && docs.has(m.documentId) ? { id: m.documentId, title: docs.get(m.documentId)!.title } : undefined }));
  return (
    <Screen n={27} brief={<Brief metrics={agentsBrief(view)} live={presenceOf(view.members, session.user)} />}>
      <Bento tone="strong" aria-label={`# ${space.name}`}>
        <BentoHead
          title={`# ${space.name}`}
          aside={
            <>
              <Pill size="sm" tone="outline">Discussion</Pill>
              <Link href={`/spaces/${space.spaceId}/files`} className="eb-pill" data-size="sm">Files</Link>
            </>
          }
        />
        <p className="eb-note">{space.topic}{space.projectId ? ` · ${projectName(view, space.projectId)}` : ""} · {space.members.length} members</p>
        <Feed spaceId={space.spaceId} messages={messages} canPost={ctx.member.role !== "viewer"} me={session.user.name} />
      </Bento>
    </Screen>
  );
}
