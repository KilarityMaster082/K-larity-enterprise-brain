"use client";
// Owner task: EB-103 Communications hub — In-App Email Composer & Reply (screen 7): a drawer over the thread with
// Reply / Reply all / Forward, basic formatting, attachments (names only in development), an AI draft suggestion the
// person accepts or dismisses, and autosave in this browser. "Send" files the draft in Approvals; nothing leaves K!larity
// until someone approves it (CLAUDE.md rule 10).
import { Icon, PillButton, useToast } from "@klarity/ui";
import { useEffect, useRef, useState, useTransition } from "react";

import { applyFormat, type Format } from "@/lib/compose";
import { submitReplyAction } from "@/lib/data/actions";

interface Ctx {
  threadId: string;
  subject: string;
  to: string;
  cc: string;
  suggestion: string;
  suggestionText: string;
}

type Mode = "reply" | "reply_all" | "forward";
const MODE_LABEL: Record<Mode, string> = { reply: "Reply", reply_all: "Reply all", forward: "Forward" };

const draftKey = (tenantId: string, id: string) => `kb-draft:${tenantId}:${id}`;
function readDraft(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function writeDraft(key: string, v: string) {
  try {
    if (v) window.localStorage.setItem(key, v);
    else window.localStorage.removeItem(key);
  } catch {
    /* private window: the draft simply is not kept */
  }
}

export function ComposerDrawer({ threadId, tenantId, mode: initialMode, onClose }: { threadId: string; tenantId: string; mode?: string; onClose: () => void }) {
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(initialMode === "reply_all" || initialMode === "forward" ? initialMode : "reply");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, start] = useTransition();
  const toast = useToast();
  const area = useRef<HTMLTextAreaElement>(null);
  const key = draftKey(tenantId, threadId);

  useEffect(() => {
    const ctl = new AbortController();
    fetch(`/api/communications/${encodeURIComponent(threadId)}`, { signal: ctl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "This thread is not available." : "The composer could not be opened.");
        return (await r.json()) as Ctx;
      })
      .then((c) => {
        setCtx(c);
        setBody(readDraft(key));
        requestAnimationFrame(() => area.current?.focus());
      })
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : "The composer could not be opened.");
      });
    return () => ctl.abort();
  }, [threadId, key]);

  useEffect(() => {
    const t = setTimeout(() => {
      writeDraft(key, body);
      setSaved(Boolean(body));
    }, 600);
    return () => clearTimeout(t);
  }, [body, key]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function format(f: Format) {
    const el = area.current;
    if (!el) return;
    const r = applyFormat(body, el.selectionStart, el.selectionEnd, f);
    setBody(r.text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(r.start, r.end);
    });
  }

  function send() {
    if (!ctx) return;
    const text = files.length ? `${body.trim()}\n\nAttachments (named only in development): ${files.join(", ")}` : body;
    start(async () => {
      const res = await submitReplyAction(ctx.threadId, mode, text);
      if (res.ok) {
        writeDraft(key, "");
        toast("Draft filed in Approvals. Nothing is sent until a partner approves it.");
        onClose();
      } else toast(res.error, "danger");
    });
  }

  return (
    <section className="eb-composer-drawer" role="dialog" aria-label="Compose a reply" aria-modal="false">
      <header className="eb-composer-head">
        <span className="eb-grow eb-trunc">{ctx ? `${mode === "forward" ? "Fwd" : "Re"}: ${ctx.subject}` : "Compose"}</span>
        <label className="visually-hidden" htmlFor="compose-mode">Reply type</label>
        <select id="compose-mode" value={mode} onChange={(e) => setMode(e.target.value as Mode)} className="eb-composer-mode">
          {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
            <option key={m} value={m}>{MODE_LABEL[m]}</option>
          ))}
        </select>
        <button type="button" className="eb-composer-x" onClick={onClose} aria-label="Close the composer"><Icon name="close" size={14} /></button>
      </header>
      {error ? (
        <p role="alert" className="eb-body" style={{ padding: 14 }}>{error}</p>
      ) : !ctx ? (
        <p role="status" className="eb-body" style={{ padding: 14 }}>Opening…</p>
      ) : (
        <>
          <p className="eb-composer-line">To: {mode === "forward" ? <em>choose a recipient in Approvals</em> : ctx.to}{mode === "reply_all" && ctx.cc ? <> · Cc: {ctx.cc}</> : null}</p>
          <div className="eb-composer-tools" role="toolbar" aria-label="Formatting">
            {([["bold", <b key="b">B</b>], ["italic", <i key="i">I</i>], ["list", "•"], ["quote", "“"], ["link", <Icon key="l" name="link" size={12} />]] as [Format, React.ReactNode][]).map(([f, label]) => (
              <button key={f} type="button" onClick={() => format(f)} aria-label={f[0]!.toUpperCase() + f.slice(1)}>{label}</button>
            ))}
          </div>
          <label className="visually-hidden" htmlFor="compose-body">Message</label>
          <textarea id="compose-body" ref={area} className="eb-composer-body" rows={7} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your reply…" />
          {ctx.suggestion && !dismissed ? (
            <div className="eb-composer-ai" role="note">
              {ctx.suggestion}{" "}
              <button type="button" className="eb-linklike" style={{ fontWeight: 700 }} onClick={() => { setBody((b) => `${b}${b && !b.endsWith("\n") ? "\n\n" : ""}${ctx.suggestionText}`); setDismissed(true); }}>Accept</button>
              {" · "}
              <button type="button" className="eb-linklike" onClick={() => setDismissed(true)}>Dismiss</button>
            </div>
          ) : null}
          {files.length ? (
            <div className="eb-row" style={{ padding: "0 14px 6px" }} aria-label="Attachments">
              {files.map((f) => (
                <span key={f} className="eb-pill" data-tone="outline" data-size="sm">{f}<button type="button" className="eb-linklike" aria-label={`Remove ${f}`} onClick={() => setFiles((x) => x.filter((y) => y !== f))}> ×</button></span>
              ))}
            </div>
          ) : null}
          <footer className="eb-composer-foot">
            <PillButton tone="black" size="lg" disabled={busy || !body.trim()} onClick={send}>Send</PillButton>
            <label className="eb-note" style={{ cursor: "pointer" }}>
              <Icon name="paperclip" size={12} /> Attach file
              <input type="file" multiple className="visually-hidden" onChange={(e) => setFiles((x) => [...x, ...Array.from(e.target.files ?? []).map((f) => f.name.slice(0, 120))].slice(0, 10))} />
            </label>
            <span className="eb-auto eb-note dim" role="status">{saved ? "Saved as draft" : ""}</span>
          </footer>
        </>
      )}
    </section>
  );
}
