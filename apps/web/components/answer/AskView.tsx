"use client";
// Owner task: EB-50 Ask Brain UI (streaming: EB-96) — composer, live progress, streamed answer, Stop, and the
// answer thread. A stopped or dropped stream never leaves a half answer on screen.
import { Badge, Icon } from "@klarity/ui";
import { useEffect, useRef, useState } from "react";

import { ApiError, askStream } from "@/lib/api";
import { apply, EMPTY_PARTIAL, STAGES, type PartialAnswer } from "@/lib/ask/stream";
import { ANSWER_CONTRACT_VERSION, type AnswerContract, type Evidence } from "@/lib/contracts";

import { SourcePanel } from "../sources/SourcePanel";
import AnswerCard from "./AnswerCard";

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
    answer: p.answer,
    facts: p.facts,
    causes: p.causes,
    risks: p.risks,
    unknowns: p.unknowns,
    confidence: { level: "medium", reason: "" },
    actions: [],
    evidence: p.evidence,
    generatedAt: "",
  };
}

export function AskView({
  workspace,
  suggestions,
  scope,
  initialQuestion,
  onFirstAnswer,
}: {
  workspace: string;
  suggestions: string[];
  scope?: { id: string; name: string };
  initialQuestion?: string;
  onFirstAnswer?: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [scoped, setScoped] = useState(scope);
  const [source, setSource] = useState<{ evidence: Evidence; citedFor: string[] } | null>(null);
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
    <div className={`ask ${empty ? "ask-empty" : ""}`}>
      {empty ? (
        <div className="ask-hero">
          <h1>What do you want to know?</h1>
          <p>
            Ask anything about {scoped ? scoped.name : workspace}. Answers come from your email, chats, documents and ledgers, with
            the source for every claim. Figures come from the ledger, never from the AI.
          </p>
        </div>
      ) : (
        <div className="thread" aria-live="polite">
          {turns.map((t) => (
            <div key={t.id} className="turn">
              <p className="question">
                <span className="visually-hidden">You asked: </span>
                {t.question}
              </p>
              {t.answer ? (
                <AnswerCard answer={t.answer} onOpenEvidence={(evidence, citedFor) => setSource({ evidence, citedFor })} />
              ) : t.error ? (
                <div className="card answer answer-error" role="alert">
                  <Icon name="alert" /> Couldn&apos;t get an answer: {t.error}.{" "}
                  <button type="button" className="btn btn-sm" onClick={() => void ask(t.question)}>
                    Try again
                  </button>
                </div>
              ) : t.stopped ? (
                <div className="card answer answer-error" role="status">
                  <Icon name="info" /> Stopped. The partial answer was discarded so nothing unchecked stays on screen.{" "}
                  <button type="button" className="btn btn-sm" onClick={() => void ask(t.question)}>
                    Ask again
                  </button>
                </div>
              ) : t.partial && t.partial.answer.length ? (
                <AnswerCard answer={asContract(t.question, t.partial)} streaming onOpenEvidence={(evidence, citedFor) => setSource({ evidence, citedFor })} />
              ) : (
                <Progress stage={t.partial?.stage ?? 0} />
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}

      <form
        className="composer card"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(draft);
        }}
      >
        {scoped ? (
          <div className="row">
            <Badge tone="brand" icon="projects">
              Only {scoped.name}
            </Badge>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setScoped(undefined)} aria-label={`Remove the ${scoped.name} scope`}>
              <Icon name="close" size={14} /> All projects
            </button>
          </div>
        ) : null}
        <label htmlFor="question" className="visually-hidden">
          Ask a question
        </label>
        <textarea
          id="question"
          className="composer-input"
          rows={empty ? 3 : 1}
          maxLength={2000}
          placeholder={scoped ? `Ask about ${scoped.name}…` : "Ask about a project, decision, payment or document…"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void ask(draft);
            }
          }}
        />
        <div className="composer-bar">
          <span className="composer-hint">
            <Icon name="lock" size={14} /> Only sources you can access are searched
          </span>
          {busy ? (
            <button type="button" className="btn btn-dark" onClick={() => ctl.current?.abort()}>
              <Icon name="close" size={16} /> Stop
            </button>
          ) : (
            <button type="submit" className="btn btn-primary" disabled={!draft.trim()} aria-label="Ask">
              <Icon name="send" size={16} /> Ask
            </button>
          )}
        </div>
      </form>

      {empty ? (
        <div className="suggestions" aria-label="Suggested questions">
          {suggestions.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => void ask(s)}>
              {s}
            </button>
          ))}
        </div>
      ) : null}

      <SourcePanel evidence={source?.evidence ?? null} citedFor={source?.citedFor ?? []} onClose={() => setSource(null)} />
    </div>
  );
}

function Progress({ stage }: { stage: number }) {
  return (
    <div className="card answer progress" role="status" aria-label="Working on your answer">
      <ol className="steps">
        {STAGES.map((label, i) => (
          <li key={label} className={i < stage ? "done" : i === stage ? "active" : ""}>
            <span className="step-dot" aria-hidden="true">
              {i < stage ? <Icon name="check" size={12} /> : null}
            </span>
            {label}
          </li>
        ))}
      </ol>
      <div className="skeleton" style={{ height: 14, width: "92%" }} />
      <div className="skeleton" style={{ height: 14, width: "78%" }} />
      <div className="skeleton" style={{ height: 14, width: "64%" }} />
    </div>
  );
}
