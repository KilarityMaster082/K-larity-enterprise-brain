"use client";
// Owner task: EB-106 Agents and background jobs — the channel feed: message list, reactions and the composer. Posting and
// reacting go through server actions that check the role and write an audit event.
import { Avatar, PillButton, formatRelative, useToast } from "@klarity/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useOverlay } from "@/components/overlays/useOverlay";
import { postSpaceMessageAction, reactAction } from "@/lib/data/actions";
import { DEMO_NOW } from "@/lib/data/derive";
import type { SpaceMessage } from "@/lib/data/types";
import { initialsOf } from "@/lib/workspace";

type Msg = SpaceMessage & { document?: { id: string; title: string } };
const EMOJI = ["👍", "✅", "👀"];

/** Wraps @mentions of known members in <mark>. */
function withMentions(text: string, mentions: string[] = []) {
  if (!mentions.length) return text;
  const re = new RegExp(`(@(?:${mentions.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}))`, "g");
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i} className="eb-mention">{part}</mark> : part));
}

export function Feed({ spaceId, messages, canPost, me }: { spaceId: string; messages: Msg[]; canPost: boolean; me: string }) {
  const [text, setText] = useState("");
  const [busy, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const open = useOverlay();

  function post() {
    const t = text.trim();
    if (!t) return;
    start(async () => {
      const res = await postSpaceMessageAction(spaceId, t);
      if (res.ok) {
        setText("");
        router.refresh();
      } else toast(res.error, "danger");
    });
  }
  function react(messageId: string, emoji: string) {
    start(async () => {
      const res = await reactAction(spaceId, messageId, emoji);
      if (!res.ok) toast(res.error, "danger");
      router.refresh();
    });
  }

  return (
    <div>
      {messages.length === 0 ? <p className="eb-body" style={{ marginTop: 12 }}>No messages yet.</p> : null}
      {messages.map((m) => (
        <article key={m.messageId} className="eb-msg" aria-label={`${m.author}, ${formatRelative(m.at, DEMO_NOW)}`}>
          <div className="eb-row" style={{ gap: 8 }}>
            <Avatar label={initialsOf(m.author)} small />
            <b>{m.author}</b>
            <span className="eb-note">{formatRelative(m.at, DEMO_NOW)}</span>
          </div>
          <p className="eb-body" style={{ margin: "4px 0 0" }}>{withMentions(m.text, m.mentions)}</p>
          {m.document ? (
            <button type="button" className="eb-pill" data-tone="outline" data-size="sm" style={{ marginTop: 6 }} onClick={() => open("view", m.document!.id)}>
              📎 {m.document.title}
            </button>
          ) : null}
          <div className="eb-row" style={{ gap: 6, marginTop: 6 }}>
            {(m.reactions ?? []).map((r) => (
              <span key={r.emoji} className="eb-pill" data-size="sm" data-tone="outline" aria-label={`${r.count} ${r.emoji}`}>{r.emoji} {r.count}</span>
            ))}
            {canPost
              ? EMOJI.map((e) => (
                  <button key={e} type="button" className="eb-pill" data-size="sm" disabled={busy} onClick={() => react(m.messageId, e)} aria-label={`React ${e}`}>{e}</button>
                ))
              : null}
          </div>
          {(m.replies ?? []).map((r, i) => (
            <div key={i} className="eb-msg" style={{ marginLeft: 12 }}>
              <div className="eb-row" style={{ gap: 8 }}><b>{r.author}</b><span className="eb-note">{formatRelative(r.at, DEMO_NOW)}</span></div>
              <p className="eb-body" style={{ margin: "2px 0 0" }}>{r.text}</p>
            </div>
          ))}
        </article>
      ))}
      {canPost ? (
        <form className="eb-row" style={{ marginTop: 16, gap: 8 }} onSubmit={(e) => { e.preventDefault(); post(); }}>
          <label className="eb-grow">
            <span className="visually-hidden">Message as {me}</span>
            <input className="eb-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Message this space" maxLength={2000} />
          </label>
          <PillButton tone="black" type="submit" disabled={busy || !text.trim()}>Post</PillButton>
        </form>
      ) : (
        <p className="eb-note" style={{ marginTop: 14 }}>You have read-only access to this space.</p>
      )}
    </div>
  );
}
