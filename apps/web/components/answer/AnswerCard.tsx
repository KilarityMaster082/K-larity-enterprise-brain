// Owner task: EB-50 Ask Brain UI — renders one answer contract as a card.
// Trust rules made visible: every claim cites evidence; figures show they came from SQL; the card says
// what it could not confirm; actions that change anything are marked as needing approval.
"use client";

import { useState, type ReactNode } from "react";

import CitationList from "@/components/citations/CitationList";
import type { AnswerContract, Claim, ConfidenceLevel, Evidence } from "@/lib/contracts";
import { formatINR, formatINRShort } from "@/lib/format";

import { Icon } from "../ui/Icon";
import { Feedback } from "./Feedback";

const CONFIDENCE: Record<ConfidenceLevel, { label: string; cls: string }> = {
  high: { label: "High confidence", cls: "badge-ok" },
  medium: { label: "Medium confidence", cls: "badge-warn" },
  low: { label: "Low confidence", cls: "badge-danger" },
};

interface Props {
  answer: AnswerContract;
  onOpenEvidence: (evidence: Evidence, citedFor: string[]) => void;
}

export default function AnswerCard({ answer, onOpenEvidence }: Props) {
  const [queued, setQueued] = useState<string | null>(null);
  const number = new Map(answer.evidence.map((e, i) => [e.id, i + 1]));
  const byId = new Map(answer.evidence.map((e) => [e.id, e]));

  const citedFor = (id: string): string[] =>
    [...answer.facts, ...answer.causes, ...answer.risks].filter((c) => c.evidenceIds.includes(id)).map((c) => c.text);

  const open = (id: string) => {
    const e = byId.get(id);
    if (e) onOpenEvidence(e, citedFor(id));
  };


  if (answer.status === "insufficient_evidence" || answer.status === "no_access") {
    return (
      <article className="card answer answer-empty" aria-label="Answer">
        <div className="answer-head">
          <span className="badge badge-danger">
            <Icon name="question" size={14} /> Not enough evidence
          </span>
        </div>
        <p className="answer-text">{answer.answer.map((s) => s.text).join("")}</p>
        {answer.unknowns.length ? (
          <ul className="answer-tips">
            {answer.unknowns.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        ) : null}
        <Feedback question={answer.question} />
      </article>
    );
  }

  const conf = CONFIDENCE[answer.confidence.level];
  const figures = answer.facts.filter((f) => f.figure);

  return (
    <article className="card answer" aria-label="Answer">
      <div className="answer-head">
        <span className={`badge ${conf.cls}`} title={answer.confidence.reason}>
          {conf.label}
        </span>
        <span className="answer-meta">
          {answer.evidence.length} source{answer.evidence.length === 1 ? "" : "s"} · {answer.confidence.reason}
        </span>
      </div>

      <p className="answer-text">
        {answer.answer.map((s, i) => (
          <span key={i}>
            {s.text}
            <CiteChips number={number} byId={byId} open={open} ids={s.evidenceIds} />
          </span>
        ))}
      </p>

      {figures.length ? (
        <section aria-label="Key figures">
          <div className="figures">
            {figures.map((f) => (
              <div key={f.id} className="figure">
                <span className="figure-label">{f.text}</span>
                <span className="figure-value" title={formatINR(f.figure!.amount)}>
                  {formatINRShort(f.figure!.amount)}
                </span>
                <span className="figure-foot">
                  <span className="badge badge-brand" title={`Computed by ${f.figure!.query ?? "a reviewed SQL query"}`}>
                    <Icon name="database" size={12} /> From ledger
                  </span>
                  <CiteChips number={number} byId={byId} open={open} ids={f.evidenceIds} />
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <ClaimList title="Why" items={answer.causes} cite={(ids) => <CiteChips ids={ids} number={number} byId={byId} open={open} />} />

      {answer.risks.length ? (
        <section className="answer-section" aria-label="Risks">
          <h3>Risks</h3>
          <ul className="claims">
            {answer.risks.map((r) => (
              <li key={r.id}>
                <span className={`badge ${r.severity === "high" ? "badge-danger" : "badge-warn"}`}>{r.severity}</span>{" "}
                {r.text}
                <CiteChips number={number} byId={byId} open={open} ids={r.evidenceIds} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {answer.unknowns.length ? (
        <section className="answer-section unknowns" aria-label="Not confirmed">
          <h3>
            <Icon name="info" size={16} /> What I couldn&apos;t confirm
          </h3>
          <ul>
            {answer.unknowns.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {answer.actions.length ? (
        <section className="answer-section" aria-label="Suggested actions">
          <h3>Suggested next steps</h3>
          <div className="actions">
            {answer.actions.map((a) => (
              <button key={a.id} type="button" className="btn" onClick={() => setQueued(a.label)}>
                {a.label}
                {a.requiresApproval ? <span className="badge">Needs approval</span> : null}
              </button>
            ))}
          </div>
          {queued ? (
            <p className="queued" role="status">
              <Icon name="check" size={16} /> Draft prepared for approval: “{queued}”. Nothing is sent until someone
              approves it in Approvals.
            </p>
          ) : null}
        </section>
      ) : null}

      <CitationList evidence={answer.evidence} onOpen={(e) => open(e.id)} />
      <Feedback question={answer.question} />
    </article>
  );
}

function CiteChips({
  ids,
  number,
  byId,
  open,
}: {
  ids?: string[];
  number: Map<string, number>;
  byId: Map<string, Evidence>;
  open: (id: string) => void;
}) {
  if (!ids?.length) return null;
  return (
    <span className="cites">
      {ids.map((id) =>
        number.has(id) ? (
          <button
            key={id}
            type="button"
            className="cite"
            onClick={() => open(id)}
            aria-label={`Source ${number.get(id)}: ${byId.get(id)?.title}`}
          >
            {number.get(id)}
          </button>
        ) : null,
      )}
    </span>
  );
}

function ClaimList({ title, items, cite }: { title: string; items: Claim[]; cite: (ids: string[]) => ReactNode }) {
  if (!items.length) return null;
  return (
    <section className="answer-section" aria-label={title}>
      <h3>{title}</h3>
      <ul className="claims">
        {items.map((c) => (
          <li key={c.id}>
            {c.text}
            {cite(c.evidenceIds)}
          </li>
        ))}
      </ul>
    </section>
  );
}
