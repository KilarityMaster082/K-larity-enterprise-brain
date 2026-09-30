// Owner task: EB-105 Meetings and live notes — Meetings & Calendar Hub (screen 19): the week's meetings from the connected
// calendar, the next one up, and the archive of past calls with their transcripts.
import { Bento, BentoHead, Grid, PillLink } from "@klarity/ui";
import type { Metadata } from "next";
import Link from "next/link";

import { NoAccess } from "@/components/page/common";
import { Brief, Screen, presenceOf } from "@/components/page/Screen";
import { meetBrief } from "@/lib/briefs";
import { DEMO_NOW } from "@/lib/data/derive";
import { addDays, meetingsOn, nextUp, parseWeek, startsIn, timeOf, weekDays } from "@/lib/meetings";
import { pageContext } from "@/lib/page";
import { projectName, toneFor } from "@/lib/workspace";

export const metadata: Metadata = { title: "Meetings" };

export default async function MeetingsPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const ctx = await pageContext("/meetings", "meetings.view");
  if (!ctx.allowed) return <NoAccess what="meetings" />;
  const { week } = await searchParams;
  const { view, session } = ctx;
  const meetings = view.data.workspace.meetings;
  const monday = parseWeek(week, DEMO_NOW);
  const days = weekDays(monday);
  const next = nextUp(meetings, DEMO_NOW);
  const past = meetings.filter((m) => m.status === "past").sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  const calendar = view.sources.find((s) => s.connectorType === "calendar");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(DEMO_NOW);
  const wk = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(`${monday}T12:00:00+05:30`));

  return (
    <Screen n={19} brief={<Brief metrics={meetBrief(view)} live={presenceOf(view.members, session.user)} />}>
      <Grid cols="1.6fr 1fr" align="start">
        <Bento tone="strong" aria-label="Week calendar">
          <BentoHead
            title={`Week of ${wk}`}
            aside={
              <span className="eb-row" style={{ gap: 5 }}>
                <PillLink size="sm" href={`/meetings?week=${addDays(monday, -7)}`} aria-label="Previous week">‹</PillLink>
                <PillLink size="sm" href="/meetings">Today</PillLink>
                <PillLink size="sm" href={`/meetings?week=${addDays(monday, 7)}`} aria-label="Next week">›</PillLink>
                <span className="eb-note">{calendar ? `Synced with ${calendar.displayName}` : "Calendar not connected"}</span>
              </span>
            }
          />
          <div className="eb-weekgrid">
            {days.map((d) => {
              const items = meetingsOn(meetings, d.key);
              return (
                <section key={d.key} className="eb-day" data-today={d.key === today || undefined} aria-label={d.label}>
                  <h3 className="eb-eyebrow">{d.label}</h3>
                  {items.map((m) => (
                    <Link key={m.meetingId} href={m.status === "live" ? "/meetings/live" : `/meetings/${m.meetingId}/prep`} className="eb-event" style={{ background: m.status === "live" ? "var(--eb-lime)" : `var(--eb-${toneFor(m.projectId ?? m.kind)})` }}>
                      <b>{timeOf(m.startsAt)} {m.title}</b>
                      <br />
                      {projectName(view, m.projectId)}{m.status === "live" ? " · live" : ""}
                    </Link>
                  ))}
                  {!items.length ? <span className="eb-note dim">No meetings</span> : null}
                </section>
              );
            })}
          </div>
        </Bento>
        <div className="eb-stack">
          {next ? (
            <Bento tone="lime" aria-label="Next up">
              <h2 className="eb-h">{next.status === "live" ? "Live now" : `Next up · ${startsIn(next.startsAt, DEMO_NOW)}`}</h2>
              <p className="eb-big-md" style={{ margin: "8px 0 12px", lineHeight: 1.2 }}>{next.title}</p>
              <div className="eb-row">
                <PillLink tone="black" size="lg" href={next.status === "live" ? "/meetings/live" : `/meetings/call?m=${next.meetingId}`}>{next.status === "live" ? "Open live notes →" : "Join call →"}</PillLink>
                {next.status !== "live" ? <PillLink tone="outline" href={`/meetings/${next.meetingId}/prep`}>Prep brief</PillLink> : null}
              </div>
            </Bento>
          ) : (
            <Bento tone="lime"><h2 className="eb-h">Nothing scheduled</h2><p className="eb-body">Connect a calendar to see meetings here.</p></Bento>
          )}
          <Bento tone="strong" aria-label="Past call archive">
            <BentoHead title="Past call archive" />
            <ul className="eb-list" style={{ marginTop: 8 }}>
              {past.map((m) => (
                <li key={m.meetingId} className="eb-li">
                  <span className="eb-grow">{m.title} · {new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(m.startsAt))}</span>
                  <Link href={`/meetings/${m.meetingId}/prep`} className="eb-note">Transcript ↗</Link>
                </li>
              ))}
              {!past.length ? <li className="eb-body">No past calls yet.</li> : null}
            </ul>
          </Bento>
        </div>
      </Grid>
    </Screen>
  );
}
