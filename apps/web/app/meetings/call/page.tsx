// Owner task: EB-105 Meetings and live notes — Embedded Video / Audio Call View (screen 22): participant tiles, a screen-share
// stage for drawing review, live captions and call controls. Media transport (WebRTC) is not connected in this build, so the
// controls change local state only and the page says so.
import type { Metadata } from "next";

import { NoAccess } from "@/components/page/common";
import { pageContext } from "@/lib/page";
import { initialsOf } from "@/lib/workspace";

import { CallView } from "./CallView";

export const metadata: Metadata = { title: "Call" };

export default async function CallPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const ctx = await pageContext("/meetings/call", "meetings.view");
  if (!ctx.allowed) return <NoAccess what="meetings" />;
  const { m } = await searchParams;
  const { view, session } = ctx;
  const meetings = view.data.workspace.meetings;
  const meeting = meetings.find((x) => x.meetingId === m) ?? meetings.find((x) => x.status === "live") ?? meetings.find((x) => x.status === "upcoming");
  if (!meeting) return <NoAccess what="a call (nothing is scheduled)" />;
  const drawing = view.data.documents.find((d) => d.projectId === meeting.projectId && d.docType === "drawing" && d.isLatest);
  return (
    <CallView
      title={meeting.title}
      me={{ name: session.user.name, initials: initialsOf(session.user.name) }}
      others={meeting.attendees.filter((a) => a.name !== session.user.name).map((a) => ({ name: a.org === "Studio 8 Hats" ? a.name : `${a.org}`, initials: initialsOf(a.org === "Studio 8 Hats" ? a.name : a.org) }))}
      share={drawing ? `${drawing.series} Rev ${drawing.revision}` : undefined}
      captions={(meeting.transcript ?? []).map((l) => l.text)}
    />
  );
}
