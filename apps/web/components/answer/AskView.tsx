"use client";
// Owner task: EB-50 Ask Brain UI (streaming: EB-96) — composer, live progress, streamed answer, Stop, and the
// answer thread (screen 1). The stream is NDJSON conforming to the canonical AnswerContract (packages/schemas/
// answer_contract); a stopped or dropped stream never leaves a half answer on screen.
import { Bento, Grid, Icon, Pill, PillButton } from "@klarity/ui";
import { useEffect, useRef, useState } from "react";

import { ApiError, askStream } from "@/lib/api";
import { apply, EMPTY_PARTIAL, STAGES, type PartialAnswer } from "@/lib/ask/stream";
import { ANSWER_CONTRACT_VERSION, type AnswerContract } from "@/lib/contracts";

import AnswerBento from "./AnswerBento";

interface Turn {
  id: number;
  question: string;
  partial?: PartialAnswer;
  answer?: AnswerContract;
  error?: string;
  stopped?: boolean;
}

function asContract(question: string, p: PartialAnswer): AnswerContract {
  return {
    version: ANSWER_CONTRACT_VERSION,
    question,
    status: "answered",
    summary: "",
    answer: p.answer,
    facts: p.facts,
    causes: p.causes,
    risks: p.risks,
    unknowns: p.unknowns,
    conflicts: p.conflicts,
    confidence: { level: "medium", reason: "" },
    actions: [],
    evidence: p.evidence,
    generatedAt: "",
  };
}

const greetingFor = (first: string, q: string) => (
  <>
    Hi {first}, <i>here&apos;s</i> the answer to “{q.length > 90 ? `${q.slice(0, 88)}…` : q}”
  </>
);

export function AskView({
  firstName,
  workspace,
  suggestions,
  scope,
  initialQuestion,
  onFirstAnswer,
  disabledReason,
}: {
  firstName: string;
  workspace: string;
  suggestions: string[];
  scope?: { id: string; name: string };
  initialQuestion?: string;
  onFirstAnswer?: () => void;
  /** When set, asking is blocked (e.g. the workspace has no synced source). */
  disabledReason?: string;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [scoped, setScoped] = useState(scope);
  const endRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);
  const ctl = useRef<AbortController | null>(null);
  const autoAsked = useRef(false);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, busy]);

  useEffect(() => {
    if (initialQuestion && !autoAsked.current) {
      autoAsked.current = true;
      void ask(initialQuestion);
    }
    // No abort on cleanup: React's development double-mount would cancel the auto-asked stream and show it as
    // "Stopped". Only the Stop button (or a new question) aborts a stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (id: number, f: (t: Turn) => Turn) => setTurns((ts) => ts.map((t) => (t.id === id ? f(t) : t)));

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const id = nextId.current++;
    setTurns((t) => [...t, { id, question: q, partial: EMPTY_PARTIAL }]);
    setDraft("");
    setBusy(true);
    const controller = new AbortController();
    ctl.current = controller;
    try {
      for await (const ev of askStream(q, scoped?.id, controller.signal)) {
        if (ev.type === "done") {
          update(id, (t) => ({ ...t, partial: undefined, answer: ev.contract }));
          onFirstAnswer?.();
        } else if (ev.type === "error") {
          update(id, (t) => ({ ...t, partial: undefined, error: ev.message }));
        } else {
          update(id, (t) => ({ ...t, partial: t.partial ? apply(t.partial, ev) : t.partial }));
        }
      }
    } catch (e) {
      if (controller.signal.aborted) {
        update(id, (t) => ({ ...t, partial: undefined, stopped: true }));
      } else if (e instanceof ApiError && e.status === 401) {
        window.location.href = "/login?next=/ask";
        return;
      } else {
        update(id, (t) => ({ ...t, partial: undefined, error: e instanceof Error ? e.message : "something went wrong" }));
      }
    } finally {
      setBusy(false);
      ctl.current = null;
    }
  }

  const empty = turns.length === 0;

  return (
    <div className="eb-ask">
      {empty ? (
        <Grid cols="1.25fr 1fr" align="start">
          <Bento tone="hero" pad="lg" enter className="eb-stack" style={{ minHeight: 210 }}>
            <h1 className="eb-hero-title">
              Hi {firstName}, <i>what</i> do you want to know about {scoped ? scoped.name : workspace}?
            </h1>
            <p className="eb-body">Answers come from your email, chats, documents and ledgers, with the source for every claim. Figures come from the ledger, never from the AI.</p>
            {disabledReason ? (
              <p className="eb-body" role="note">
                <Pill tone="cream">
                  <Icon name="info" size={12} /> {disabledReason}
                </Pill>
              </p>
            ) : null}
            <div className="eb-row" aria-label="Suggested questions">
              {suggestions.map((s, i) => (
                <PillButton key={s} tone={i === 0 ? "default" : "glass"} style={i === 0 ? { fontWeight: 600 } : undefined} onClick={() => void ask(s)} disabled={busy || Boolean(disabledReason)}>
                  {s}
                </PillButton>
              ))}
            </div>
          </Bento>
          <Bento tone="lime" fill>
            <h2 className="eb-h">Figures from the ledger</h2>
            <p className="eb-body">Every amount is computed by a reviewed SQL view and tagged <b>From ledger</b>. The model never writes a number.</p>
          </Bento>
          <Grid cols="1fr 1fr" tight align="stretch">
            <Bento tone="black" fill>
              <h2 className="eb-h">Every claim cites</h2>
              <p className="eb-note">Tap E1, E2… to see the exact passage.</p>
            </Bento>
            <Bento tone="cream">
              <h2 className="eb-h">Says what it can&apos;t confirm</h2>
              <p className="eb-body">Gaps are listed, not guessed.</p>
            </Bento>
          </Grid>
        </Grid>
      ) : (
        <div className="eb-stack" aria-live="polite">
          {turns.map((t) => (
            <section key={t.id} className="eb-stack tight" aria-label={`Question: ${t.question}`}>
              {t.answer ? (
                <AnswerBento answer={t.answer} greeting={greetingFor(firstName, t.question)} />
              ) : t.error ? (
                <Bento tone="pink" role="alert" className="eb-row">
                  <Icon name="alert" size={14} /> Couldn&apos;t get an answer: {t.error}.{" "}
                  <PillButton tone="black" onClick={() => void ask(t.question)}>
                    Try again
                  </PillButton>
                </Bento>
              ) : t.stopped ? (
                <Bento tone="cream" role="status" className="eb-row">
                  <Icon name="info" size={14} /> Stopped. The partial answer was discarded so nothing unchecked stays on screen.{" "}
                  <PillButton tone="black" onClick={() => void ask(t.question)}>
                    Ask again
                  </PillButton>
                </Bento>
              ) : t.partial && t.partial.answer.length ? (
                <AnswerBento answer={asContract(t.question, t.partial)} streaming greeting={greetingFor(firstName, t.question)} />
              ) : (
                <Progress question={t.question} stage={t.partial?.stage ?? 0} />
              )}
            </section>
          ))}
          <div ref={endRef} />
        </div>
      )}

      <form
        className="eb-composer eb-sticky"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(draft);
        }}
      >
        <div className="eb-grow eb-stack tight">
          {scoped ? (
            <div className="eb-row">
              <Pill tone="lime">
                <Icon name="projects" size={12} /> Only {scoped.name}
              </Pill>
              <PillButton tone="outline" size="sm" onClick={() => setScoped(undefined)} aria-label={`Remove the ${scoped.name} scope`}>
                <Icon name="close" size={11} /> All projects
              </PillButton>
            </div>
          ) : null}
          <label htmlFor="question" className="visually-hidden">
            Ask a question
          </label>
          <textarea
            id="question"
            rows={1}
            maxLength={2000}
            placeholder={scoped ? `Ask about ${scoped.name}…` : "Ask about projects, payments, drawings…"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void ask(draft);
              }
            }}
          />
        </div>
        <Pill tone="outline" size="sm" title="Permissions are checked before retrieval and again before sensitive evidence is shown">
          <Icon name="lock" size={11} /> Only sources you can access
        </Pill>
        {busy ? (
          <button type="button" className="eb-send" onClick={() => ctl.current?.abort()} aria-label="Stop">
            <Icon name="close" size={14} />
          </button>
        ) : (
          <button type="submit" className="eb-send" disabled={!draft.trim() || Boolean(disabledReason)} aria-label="Ask">
            <Icon name="send" size={14} />
          </button>
        )}
      </form>
    </div>
  );
}

function Progress({ question, stage }: { question: string; stage: number }) {
  return (
    <Bento tone="hero" pad="lg" className="eb-stack" role="status" aria-label="Working on your answer">
      <h2 className="eb-hero-title">{question}</h2>
      <ol className="eb-stack tight" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {STAGES.map((label, i) => (
          <li key={label} className="eb-row" style={{ fontWeight: i === stage ? 600 : 400, opacity: i > stage ? 0.55 : 1 }}>
            <span className="eb-avatar eb-avatar-sm" style={{ background: i < stage ? "var(--eb-lime)" : i === stage ? "var(--eb-black)" : "rgb(255 255 255 / .6)", color: i === stage ? "#fff" : "var(--eb-black)" }}>
              {i < stage ? <Icon name="check" size={11} /> : i + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>
    </Bento>
  );
}
