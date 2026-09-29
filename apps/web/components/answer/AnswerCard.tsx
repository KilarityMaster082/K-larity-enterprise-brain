"use client";
// Owner task: EB-50 Ask Brain UI — renders one answer contract as a card (also while it streams in).
// Trust rules made visible: every claim cites evidence; figures show they came from SQL; the card says what it
// could not confirm; actions that change anything become drafts in Approvals (CLAUDE.md rule 10).
import { Badge, formatINR, formatINRShort, Icon, useToast } from "@klarity/ui";
import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";

import CitationList from "@/components/citations/CitationList";
import type { AnswerContract, Claim, ConfidenceLevel, Evidence, SuggestedAction } from "@/lib/contracts";
import { requestApprovalAction } from "@/lib/data/actions";

import { Feedback } from "./Feedback";

const CONFIDENCE: Record<ConfidenceLevel, { label: string; tone: "ok" | "warn" | "danger" }> = {
  high: { label: "High confidence", tone: "ok" },
  medium: { label: "Medium confidence", tone: "warn" },
  low: { label: "Low confidence", tone: "danger" },
};

interface Props {
  answer: AnswerContract;
  streaming?: boolean;
  onOpenEvidence: (evidence: Evidence, citedFor: string[]) => void;
}

function CiteChips({ ids, number, byId, open }: { ids?: string[]; number: Map<string, number>; byId: Map<string, Evidence>; open: (id: string) => void }) {
  if (!ids?.length) return null;
  return (
    <span className="cites">
      {ids.map((id) =>
        number.has(id) ? (
          <button key={id} type="button" className="cite" onClick={() => open(id)} aria-label={`Source ${number.get(id)}: ${byId.get(id)?.title}`}>
            {number.get(id)}
          </button>
        ) : null,
      )}
    </span>
  );
}

export default function AnswerCard({ answer, streaming, onOpenEvidence }: Props) {
  const [queued, setQueued] = useState<Record<string, string>>({});
  const [busy, start] = useTransition();
  const toast = useToast();
  const number = new Map(answer.evidence.map((e, i) => [e.id, i + 1]));
  const byId = new Map(answer.evidence.map((e) => [e.id, e]));

  const citedFor = (id: string): string[] =>
    [...answer.facts, ...answer.causes, ...answer.risks].filter((c) => c.evidenceIds.includes(id)).map((c) => c.text);
  const open = (id: string) => {
    const e = byId.get(id);
    if (e) onOpenEvidence(e, citedFor(id));
  };
  const cite = (ids?: string[]) => <CiteChips ids={ids} number={number} byId={byId} open={open} />;

  function accept(a: SuggestedAction) {
    if (!a.draft) return;
    const draft = a.draft;
    start(async () => {
      const res = await requestApprovalAction({ ...draft, kind: a.kind === "create_task" ? "create_task" : "draft_message" });
      if (res.ok) {
        setQueued((q) => ({ ...q, [a.id]: res.message ?? "" }));
        toast("Draft sent to Approvals. Nothing is sent until someone approves it.");
      } else toast(res.error, "danger");
    });
  }

  if (!streaming && (answer.status === "insufficient_evidence" || answer.status === "no_access")) {
    return (
      <article className="card answer answer-empty" aria-label="Answer">
        <div className="answer-head">
          <Badge tone={answer.status === "no_access" ? "warn" : "danger"} icon={answer.status === "no_access" ? "lock" : "question"}>
            {answer.status === "no_access" ? "Restricted" : "Not enough evidence"}
          </Badge>
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
    <article className="card answer" aria-label="Answer" aria-busy={streaming || undefined}>
      <div className="answer-head">
        {streaming ? (
          <Badge tone="info">Checking evidence…</Badge>
        ) : (
          <Badge tone={conf.tone} title={answer.confidence.reason}>
            {conf.label}
          </Badge>
        )}
        <span className="answer-meta">
          {answer.evidence.length} source{answer.evidence.length === 1 ? "" : "s"}
          {streaming ? "" : ` · ${answer.confidence.reason}`}
        </span>
      </div>

      <p className="answer-text">
        {answer.answer.map((s, i) => (
          <span key={i}>
            {s.text}
            {cite(s.evidenceIds)}
          </span>
        ))}
        {streaming ? <span className="stream-caret" aria-hidden="true" /> : null}
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
                  <span className="source-tag" style={{ cursor: "default" }} title={`Computed by ${f.figure!.query ?? "a reviewed SQL query"}`}>
                    <Icon name="database" size={12} /> From ledger
                  </span>
                  {cite(f.evidenceIds)}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <ClaimList title="Why" items={answer.causes} cite={cite} />

      {answer.risks.length ? (
        <section className="answer-section" aria-label="Risks">
          <h3>Risks</h3>
          <ul className="claims">
            {answer.risks.map((r) => (
              <li key={r.id}>
                <Badge tone={r.severity === "high" ? "danger" : "warn"}>{r.severity}</Badge> {r.text}
                {cite(r.evidenceIds)}
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

      {!streaming && answer.actions.length ? (
        <section className="answer-section" aria-label="Suggested actions">
          <h3>Suggested next steps</h3>
          <div className="actions">
            {answer.actions.map((a) =>
              a.kind === "open_source" ? (
                <Link key={a.id} className="btn" href="/documents">
                  {a.label}
                </Link>
              ) : queued[a.id] ? (
                <Link key={a.id} className="btn" href={`/approvals?focus=${queued[a.id]}`}>
                  <Icon name="check" size={16} /> In Approvals — view draft
                </Link>
              ) : (
                <button key={a.id} type="button" className="btn btn-wrap" disabled={busy} onClick={() => accept(a)}>
                  {a.label}
                  {a.requiresApproval ? <Badge>Needs approval</Badge> : null}
                </button>
              ),
            )}
          </div>
        </section>
      ) : null}

      {answer.evidence.length ? <CitationList evidence={answer.evidence} onOpen={(e) => open(e.id)} /> : null}
      {!streaming ? <Feedback question={answer.question} /> : null}
    </article>
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
