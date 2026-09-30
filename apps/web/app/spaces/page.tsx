// Owner task: EB-106 Agents and background jobs — Spaces & Channels Hub (screen 26): the project channels and team spaces
// the firm works in, with what is unread and who is in each. Everyone in the firm can read; viewers cannot post.
import { Avatar, Bento, BentoHead, Grid, Pill, formatRelative } from "@klarity/ui";
import type { Metadata } from "next";
import Link from "next/link";

import { NoAccess } from "@/components/page/common";
import { Brief, Screen, presenceOf } from "@/components/page/Screen";
import { agentsBrief } from "@/lib/briefs";
import { DEMO_NOW } from "@/lib/data/derive";
import { pageContext } from "@/lib/page";
import { initialsOf, projectName, toneFor } from "@/lib/workspace";

export const metadata: Metadata = { title: "Spaces" };

export default async function SpacesPage() {
  const ctx = await pageContext("/spaces", "spaces.view");
  if (!ctx.allowed) return <NoAccess what="spaces" />;
  const { view, session } = ctx;
  const spaces = view.data.workspace.spaces;
  return (
    <Screen n={26} brief={<Brief metrics={agentsBrief(view)} live={presenceOf(view.members, session.user)} />}>
      {spaces.length === 0 ? (
        <Bento tone="strong"><p className="eb-body">No spaces yet. Project channels appear here once a project has a team.</p></Bento>
      ) : (
        <Grid cols="repeat(3, minmax(0, 1fr))" align="stretch">
          {spaces.map((s) => {
            const last = s.messages[s.messages.length - 1];
            return (
              <Bento key={s.spaceId} tone={toneFor(s.spaceId)} fill>
                <BentoHead title={`# ${s.name}`} aside={s.unread ? <Pill tone="black" size="sm">{s.unread} new</Pill> : undefined} />
                <p className="eb-body" style={{ marginTop: 6 }}>{s.topic}</p>
                {s.projectId ? <p className="eb-note">{projectName(view, s.projectId)}</p> : null}
                {last ? <p className="eb-note eb-trunc" style={{ marginTop: 8 }}>{last.author}: {last.text} · {formatRelative(last.at, DEMO_NOW)}</p> : null}
                <div className="eb-row" style={{ marginTop: "auto", paddingTop: 12, justifyContent: "space-between" }}>
                  <span className="eb-avatars" aria-label={`${s.members.length} members`}>
                    {s.members.slice(0, 4).map((m) => <Avatar key={m} label={initialsOf(m)} small />)}
                  </span>
                  <span className="eb-row" style={{ gap: 6 }}>
                    <Link href={`/spaces/${s.spaceId}/files`} className="eb-pill" data-tone="outline" data-size="sm">Files</Link>
                    <Link href={`/spaces/${s.spaceId}`} className="eb-pill" data-tone="black" data-size="sm">Open</Link>
                  </span>
                </div>
              </Bento>
            );
          })}
        </Grid>
      )}
    </Screen>
  );
}
