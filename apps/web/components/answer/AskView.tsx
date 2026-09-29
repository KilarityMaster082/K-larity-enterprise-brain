// Owner task: EB-50 Ask Brain UI — question composer, progress states and the answer thread.
"use client";

import { useEffect, useRef, useState } from "react";

import { ApiError, askBrain } from "@/lib/api";
import type { AnswerContract, Evidence } from "@/lib/contracts";

import { SourcePanel } from "../sources/SourcePanel";
import { Icon } from "../ui/Icon";
import AnswerCard from "./AnswerCard";

interface Turn {
  id: number;
  question: string;
  answer?: AnswerContract;
  error?: string;
}

// Shown while the context engine works; wording mirrors the real pipeline stages (EB-47).
const STEPS = ["Understanding the question", "Searching sources you can access", "Checking every claim against evidence"];

export function AskView({ workspace, suggestions }: { workspace: string; suggestions: string[] }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState<{ evidence: Evidence; citedFor: string[] } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, busy]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const id = nextId.current++;
    setTurns((t) => [...t, { id, question: q }]);
    setDraft("");
    setBusy(true);
    try {
      const answer = await askBrain(q);
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, answer } : x)));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        window.location.href = "/login?next=/ask";
        return;
      }
      const message = e instanceof Error ? e.message : "Something went wrong";
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, error: message } : x)));
    } finally {
      setBusy(false);
    }
  }

  const empty = turns.length === 0;

  return (
    <div className={`ask ${empty ? "ask-empty" : ""}`}>
      {empty ? (
        <div className="ask-hero">
          <h1>What do you want to know?</h1>
          <p>
            Ask anything about {workspace}. Answers come from your email, chats, documents and ledgers, with the source
            for every claim. Figures come from the ledger, never from the AI.
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
                <AnswerCard
                  answer={t.answer}
                  onOpenEvidence={(evidence, citedFor) => setSource({ evidence, citedFor })}
                />
              ) : t.error ? (
                <div className="card answer answer-error" role="alert">
                  <Icon name="alert" /> Couldn&apos;t get an answer: {t.error}.{" "}
                  <button type="button" className="btn btn-sm" onClick={() => void ask(t.question)}>
                    Try again
                  </button>
                </div>
              ) : (
                <Progress />
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
        <label htmlFor="question" className="visually-hidden">
          Ask a question
        </label>
        <textarea
          id="question"
          className="composer-input"
          rows={empty ? 3 : 1}
          maxLength={2000}
          placeholder="Ask about a project, decision, payment or document…"
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
          <button type="submit" className="btn btn-primary" disabled={busy || !draft.trim()} aria-label="Ask">
            <Icon name="send" size={16} /> Ask
          </button>
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

function Progress() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 450);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="card answer progress" role="status" aria-label="Working on your answer">
      <ol className="steps">
        {STEPS.map((label, i) => (
          <li key={label} className={i < step ? "done" : i === step ? "active" : ""}>
            <span className="step-dot" aria-hidden="true">
              {i < step ? <Icon name="check" size={12} /> : null}
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
