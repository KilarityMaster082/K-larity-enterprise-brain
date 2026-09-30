// Owner task: EB-103 Communications hub — Email Thread & AI Extraction View (screen 6): the thread on the left, and on
// the right what the extractor found: key decisions (with "Send to Decision Log"), commitments and deadlines, and
// quantified variations. Quantified figures are what the email says, marked as such: they are not ledger figures.
import { Bento, BentoHead, Grid, Pill, formatDate, formatDateTime, formatINRShort } from "@klarity/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EvidenceLinks } from "@/components/evidence/EvidenceLinks";
import { OverlayButton } from "@/components/overlays/OverlayButton";
import { NoAccess } from "@/components/page/common";
import { Brief, Screen, presenceOf } from "@/components/page/Screen";
import { commsBrief } from "@/lib/briefs";
import { evidenceById } from "@/lib/data/store";
import { pageContext } from "@/lib/page";
import { projectName, visibleMail } from "@/lib/workspace";

import { OpenDocument, ThreadActions, MarkRead } from "./ThreadActions";

export const metadata: Metadata = { title: "Email thread" };

export default async function ThreadPage({ params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;
  const ctx = await pageContext(`/communications/${threadId}`, "comms.view");
  if (!ctx.allowed) return <NoAccess what="communications" />;
  const { view, session } = ctx;
  const thread = visibleMail(view, ctx.can).find((t) => t.threadId === threadId);
  if (!thread) notFound(); // another tenant's thread, or one this role may not see: nothing to show
  const ev = evidenceById(view, thread.evidenceId ? [thread.evidenceId] : []);
  const canDraftDecision = ctx.can("decisions.view") && Boolean(thread.projectId);
  const docName = (id?: string) => view.data.documents.find((d) => d.documentId === id)?.title;

  return (
    <Screen n={6} brief={<Brief metrics={commsBrief(view, ctx.can)} live={presenceOf(view.members, session.user)} />}>
      <MarkRead threadId={thread.threadId} unread={thread.unread} />
      <Grid cols="1.4fr 1fr" align="start">
        <Bento tone="white" pad="lg" aria-label="Thread">
          <div className="eb-row" style={{ justifyContent: "space-between" }}>
            <h1 className="eb-big-md" style={{ fontSize: "var(--eb-t-2xl)" }}>{thread.subject}</h1>
            <Pill tone="outline" size="sm">{thread.category}</Pill>
          </div>
          <p className="eb-li-sub" style={{ margin: "4px 0 14px" }}>
            {thread.fromOrg === "Studio 8 Hats" ? thread.fromName : `${thread.fromOrg} → ${ctx.member.name}`} · {thread.messages.length} message{thread.messages.length === 1 ? "" : "s"}
            {thread.projectId ? <> · <Link href={`/projects/${thread.projectId}`}>{projectName(view, thread.projectId)}</Link></> : null}
          </p>
          {thread.messages.map((m) => (
            <article key={m.messageId} className="eb-msg" data-decisive={m.decisive || undefined} aria-label={`${m.fromName}, ${formatDateTime(m.at)}`}>
              <p className="eb-li-sub"><b>{m.fromName}</b> · {m.fromOrg} · <time dateTime={m.at}>{formatDateTime(m.at)} IST</time></p>
              <p className="eb-body">{m.body}</p>
              {m.quoted ? (
                <details>
                  <summary className="eb-note dim" style={{ cursor: "pointer" }}>▸ {m.quoted} quoted messages</summary>
                  <p className="eb-note dim">Earlier messages in this thread are collapsed.</p>
                </details>
              ) : null}
            </article>
          ))}
          {thread.attachments.length ? (
            <div className="eb-row" style={{ marginTop: 14 }} aria-label="Attachments">
              {thread.attachments.map((a) => (a.documentId ? <OpenDocument key={a.name} documentId={a.documentId} label={a.name} title={docName(a.documentId)} /> : <Pill key={a.name} tone="outline">{a.name}</Pill>))}
            </div>
          ) : null}
          <div className="eb-row" style={{ marginTop: 14 }}>
            <OverlayButton name="compose" value={thread.threadId} tone="black">Reply</OverlayButton>
            <OverlayButton name="compose" value={thread.threadId} extra={{ mode: "reply_all" }} tone="outline">Reply all</OverlayButton>
            <OverlayButton name="compose" value={thread.threadId} extra={{ mode: "forward" }} tone="outline">Forward</OverlayButton>
            <EvidenceLinks evidence={ev} citedFor={[thread.subject]} />
          </div>
        </Bento>

        <div className="eb-stack">
          <Bento tone="lime" aria-label="Key decisions">
            <BentoHead title="Key decisions" />
            {thread.extraction.decisions.length ? (
              <ul className="eb-list" style={{ margin: "8px 0" }}>
                {thread.extraction.decisions.map((d, i) => (
                  <li key={d.text} className="eb-li" style={{ flexWrap: "wrap", borderColor: "rgba(0,0,0,.15)" }}>
                    <span className="eb-grow" style={{ fontSize: "var(--eb-t-md)" }}>{d.text}</span>
                    {canDraftDecision ? <ThreadActions threadId={thread.threadId} index={i} existing={d.decisionId} /> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="eb-body">No decision found in this thread.</p>
            )}
          </Bento>
          <Bento tone="black" aria-label="Commitments and deadlines">
            <BentoHead title="Commitments & deadlines" />
            {thread.extraction.commitments.length ? (
              <ul className="eb-stack tight" style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
                {thread.extraction.commitments.map((c) => (
                  <li key={c.text} className="eb-row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                    <span>{c.text}</span>
                    <span className="eb-lime-text" style={{ whiteSpace: "nowrap" }}>{formatDate(`${c.due}T00:00:00+05:30`)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="eb-note">No deadline found.</p>
            )}
          </Bento>
          <Bento tone="lavender" aria-label="Quantified variations">
            <BentoHead title="Quantified variations" aside={<Pill size="sm" tone="outline" title="This amount was read out of the email. It is not a ledger figure until the ledger confirms it.">As quoted in the email</Pill>} />
            {thread.extraction.variations.length ? (
              thread.extraction.variations.map((v) => (
                <div key={v.text} style={{ marginTop: 10 }}>
                  <div className="eb-big-md eb-num" title={`₹${v.amount.toLocaleString("en-IN")}`}>{formatINRShort(v.amount)}</div>
                  <p className="eb-note">{v.text}</p>
                </div>
              ))
            ) : (
              <p className="eb-note" style={{ marginTop: 8 }}>No quantified variation found.</p>
            )}
          </Bento>
        </div>
      </Grid>
    </Screen>
  );
}
