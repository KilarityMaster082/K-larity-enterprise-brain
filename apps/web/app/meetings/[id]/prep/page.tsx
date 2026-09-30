// Owner task: EB-105 Meetings and live notes — Meeting Dossier & Prep Brief (screen 20): attendees, what is still open from
// the last meeting, the drawing revisions that matter and the approvals waiting, compiled from the tenant's own data
// before the call. For a past meeting the same page shows the summary and transcript.
import { Avatar, Bento, BentoHead, Grid, Pill, PillLink, formatDateTime } from "@klarity/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EvidenceLinks } from "@/components/evidence/EvidenceLinks";
import { NoAccess } from "@/components/page/common";
import { Brief, Screen, presenceOf } from "@/components/page/Screen";
import { meetBrief } from "@/lib/briefs";
import { evidenceById } from "@/lib/data/store";
import { timeOf } from "@/lib/meetings";
import { pageContext } from "@/lib/page";
import { initialsOf, projectName } from "@/lib/workspace";

export const metadata: Metadata = { title: "Meeting brief" };

export default async function PrepPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await pageContext(`/meetings/${id}/prep`, "meetings.view");
  if (!ctx.allowed) return <NoAccess what="meetings" />;
  const { view, session } = ctx;
  const m = view.data.workspace.meetings.find((x) => x.meetingId === id);
  if (!m) notFound();
  const prep = m.prep;
  const approvals = view.approvals.filter((a) => prep?.pendingApprovalIds.includes(a.approvalId) && a.status === "pending");
  const docs = (prep?.newRevisions ?? []).map((r) => ({ ...r, doc: view.data.documents.find((d) => d.documentId === r.documentId) })).filter((r) => r.doc);
  const when = `${new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(m.startsAt))}, ${timeOf(m.startsAt)}`;

  return (
    <Screen n={20} brief={<Brief metrics={meetBrief(view)} live={presenceOf(view.members, session.user)} />}>
      <Grid cols="repeat(3, minmax(0, 1fr))" align="stretch">
        <Bento tone="sky" span={3} aria-label="Meeting">
          <div className="eb-row nowrap" style={{ gap: 18 }}>
            <div className="eb-grow">
              <h2 className="eb-eyebrow">{m.status === "past" ? "Meeting recap" : "Pre-meeting brief"}</h2>
              <h1 className="eb-big-md" style={{ marginTop: 6, fontSize: "var(--eb-t-2xl)" }}>{m.title} · {when}</h1>
              <p className="eb-note">{projectName(view, m.projectId)} · {m.attendees.length} attendees</p>
            </div>
            <Pill tone="black">{m.status === "past" ? "Notes from the call" : "Compiled by Brain"}</Pill>
            {m.status === "live" ? <PillLink tone="lime" href="/meetings/live">Open live notes →</PillLink> : null}
          </div>
        </Bento>
        <Bento tone="green" aria-label="Attendees">
          <BentoHead title="Attendees" />
          <ul className="eb-stack tight" style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
            {m.attendees.map((a) => (
              <li key={a.name} className="eb-row nowrap" style={{ background: "rgb(255 255 255 / .6)", borderRadius: 14, padding: "6px 10px" }}>
                <Avatar label={initialsOf(a.name)} tone="lime" />
                <span><b>{a.name}</b><br /><span className="eb-li-sub">{a.org}</span></span>
              </li>
            ))}
          </ul>
        </Bento>
        <Bento tone="cream" aria-label={m.status === "past" ? "Summary" : "Open from last meeting"}>
          {m.status === "past" ? (
            <>
              <BentoHead title="Summary" />
              <p className="eb-body" style={{ marginTop: 10 }}>{m.summary ?? "No summary was generated."}</p>
            </>
          ) : (
            <>
              <BentoHead title="Open from last meeting" />
              {prep?.openCommitments.length ? (
                <ul className="eb-stack tight" style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
                  {prep.openCommitments.map((c) => (
                    <li key={c.text} className="eb-body">
                      ☐ {c.text} <span className="eb-dim">· {c.owner}</span>{" "}
                      <EvidenceLinks evidence={evidenceById(view, c.evidenceId ? [c.evidenceId] : [])} citedFor={[c.text]} compact />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="eb-body" style={{ marginTop: 10 }}>Nothing was left open.</p>
              )}
            </>
          )}
        </Bento>
        <Bento tone="lavender" aria-label="Relevant revisions">
          <BentoHead title="Relevant revisions" />
          <ul className="eb-stack tight" style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
            {docs.length ? (
              docs.map((r) => (
                <li key={r.documentId} className="eb-body">
                  {r.doc!.series} <Pill tone="black" size="sm">Rev {r.doc!.revision}</Pill> <span className="eb-dim">{r.note}</span>
                </li>
              ))
            ) : (
              <li className="eb-body">No new revisions.</li>
            )}
          </ul>
        </Bento>
        {prep?.attendeeNotes.length ? (
          <Bento tone="strong" span={3} aria-label="About the attendees">
            <BentoHead title="About the attendees" eyebrow />
            <ul className="eb-list">
              {prep.attendeeNotes.map((n) => (
                <li key={n.name} className="eb-li"><b style={{ width: 170 }}>{n.name}</b><span className="eb-grow">{n.note}</span></li>
              ))}
            </ul>
          </Bento>
        ) : null}
        {m.transcript?.length ? (
          <Bento tone="white" span={3} aria-label="Transcript">
            <BentoHead title="Transcript" eyebrow />
            <ul className="eb-list">
              {m.transcript.map((l, i) => (
                <li key={i} className="eb-li" style={{ alignItems: "flex-start" }}>
                  <span className="eb-mono eb-dim" style={{ width: 44 }}>{l.at}</span>
                  <span className="eb-grow"><b>{l.speaker}:</b> {l.text}</span>
                  {l.flag ? <Pill tone={l.flag === "action" ? "lime" : l.flag === "decision" ? "lavender" : "outline"} size="sm">{l.flag}</Pill> : null}
                </li>
              ))}
            </ul>
          </Bento>
        ) : null}
        {approvals.length ? (
          <Bento tone="pink" span={3} aria-label="Approvals waiting">
            <div className="eb-row nowrap">
              <b>{approvals.length} approval{approvals.length > 1 ? "s" : ""} waiting</b>
              <span className="eb-grow eb-trunc">{approvals.map((a) => a.title).join(" · ")}</span>
              <PillLink href="/approvals">Open Approvals →</PillLink>
            </div>
          </Bento>
        ) : null}
        <p className="eb-note" style={{ gridColumn: "span 3" }}>
          Generated {formatDateTime(m.startsAt)} IST from this workspace's threads, documents and approvals. <Link href="/meetings">Back to the calendar</Link>
        </p>
      </Grid>
    </Screen>
  );
}
