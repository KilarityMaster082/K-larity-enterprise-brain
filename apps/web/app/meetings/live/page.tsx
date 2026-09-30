// Owner task: EB-105 Meetings and live notes — Live Meeting Notes & Transcription (screen 21). In development the
// transcript is a recorded session replayed line by line; production streams the call's audio into the same lines.
import { Bento, PillLink } from "@klarity/ui";
import type { Metadata } from "next";

import { NoAccess } from "@/components/page/common";
import { Brief, Screen, presenceOf } from "@/components/page/Screen";
import { meetBrief } from "@/lib/briefs";
import { pageContext } from "@/lib/page";
import { projectName } from "@/lib/workspace";

import { LiveNotes } from "./LiveNotes";

export const metadata: Metadata = { title: "Live notes" };

export default async function LivePage() {
  const ctx = await pageContext("/meetings/live", "meetings.view");
  if (!ctx.allowed) return <NoAccess what="meetings" />;
  const { view, session } = ctx;
  const live = view.data.workspace.meetings.find((m) => m.status === "live");
  return (
    <Screen n={21} brief={<Brief metrics={meetBrief(view)} live={presenceOf(view.members, session.user)} />}>
      {live ? (
        <LiveNotes
          key={live.meetingId}
          meeting={{ id: live.meetingId, title: live.title, project: projectName(view, live.projectId), lines: live.transcript ?? [] }}
          canEnd={ctx.member.role !== "viewer"}
        />
      ) : (
        <Bento tone="sky" pad="lg" className="eb-stack" style={{ maxWidth: 560 }}>
          <h1 className="eb-h-lg">No meeting is live right now</h1>
          <p className="eb-body">Live notes start when a meeting from your calendar begins. Past meetings keep their transcript and summary.</p>
          <div><PillLink tone="black" href="/meetings">Open the calendar</PillLink></div>
        </Bento>
      )}
    </Screen>
  );
}
