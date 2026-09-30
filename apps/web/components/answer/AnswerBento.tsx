"use client";
// Owner task: EB-50 Ask Brain UI — one answer contract as the handoff's bento layout (screen 1): the answer with its
// citation chips [E1] [E2] …, the headline figure from the ledger, confidence, "what I couldn't confirm", the
// per-package bars and the approval-gated next steps. Also renders while the answer streams in.
// Trust rules made visible: every claim cites evidence; figures carry their SQL origin; actions become drafts in
// Approvals and nothing is sent (CLAUDE.md rule 10).
import { Bento, BentoHead, Grid, Icon, OriginTag, Pill, PillButton, PillLink, BarRow, formatINR, formatINRCompact, formatINRShort, useToast } from "@klarity/ui";
import { useState, useTransition, type ReactNode } from "react";

import { useOverlay } from "@/components/overlays/useOverlay";
import { useTenantId } from "@/components/shell/TenantContext";
import type { AnswerContract, ConfidenceLevel, SuggestedAction } from "@/lib/contracts";
import { requestApprovalAction } from "@/lib/data/actions";
import { rememberEvidence } from "@/lib/evidence-cache";
import { chipLabel, citationStats, citedFor, evidenceById, figureRows, leadFigure } from "@/lib/ask/present";
import { SOURCE_META } from "@/lib/sources";

import { Feedback } from "./Feedback";

const CONFIDENCE: Record<ConfidenceLevel, string> = { high: "High", medium: "Medium", low: "Low" };

export default function AnswerBento({ answer, streaming, greeting }: { answer: AnswerContract; streaming?: boolean; greeting: ReactNode }) {
  const [queued, setQueued] = useState<Record<string, string>>({});
  const [busy, start] = useTransition();
  const toast = useToast();
  const tenantId = useTenantId();
  const open = useOverlay();
  const byId = evidenceById(answer);

  const openEvidence = (id: string) => {
    const e = byId.get(id);
    if (!e) return;
    rememberEvidence(tenantId, { evidence: e, citedFor: citedFor(answer, id), number: answer.evidence.indexOf(e) + 1 });
    open("source", id);
  };
  const cite = (ids?: string[]) =>
    ids?.length ? (
      <span>
        {ids.map((id) => {
          const label = chipLabel(answer, id);
          return label ? (
            <button key={id} type="button" className="eb-cite" onClick={() => openEvidence(id)} aria-label={`Evidence ${label}: ${byId.get(id)?.title}`} title={`[${label}] ${byId.get(id)?.title}`}>
              {label}
            </button>
          ) : null;
        })}
      </span>
    ) : null;

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

  const refused = !streaming && (answer.status === "insufficient_evidence" || answer.status === "no_access");
  const lead = leadFigure(answer);
  const rows = figureRows(answer);
  const stats = citationStats(answer);

  if (refused) {
    return (
      <Grid cols="1.25fr 1fr" align="start">
        <Bento tone="hero" pad="lg" enter className="eb-stack" aria-label="Answer">
          <h2 className="eb-hero-title">{greeting}</h2>
          <Pill tone={answer.status === "no_access" ? "cream" : "pink"}>
            <Icon name={answer.status === "no_access" ? "lock" : "question"} size={12} /> {answer.status === "no_access" ? "Restricted for your role" : "Not enough evidence"}
          </Pill>
          <p className="eb-body">{answer.answer.map((s) => s.text).join("")}</p>
          <Feedback question={answer.question} />
        </Bento>
        <Bento tone="cream" aria-label="What to try next">
          <BentoHead title="What I couldn't confirm" />
          <ul className="eb-body" style={{ paddingLeft: 16, margin: "8px 0 0" }}>
            {answer.unknowns.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </Bento>
      </Grid>
    );
  }

  return (
    <Grid cols="1.25fr 1fr" align="start">
      <Bento tone="hero" rows={2} pad="lg" enter className="eb-stack" aria-label="Answer" aria-live={streaming ? "polite" : undefined}>
        <h2 className="eb-hero-title">{greeting}</h2>
        <p className="eb-body" style={{ color: "#22222a" }}>
          <b>Answer.</b>{" "}
          {answer.answer.map((s, i) => (
            <span key={i}>
              {s.text}
              {cite(s.evidenceIds)}
            </span>
          ))}
          {streaming ? <span className="eb-caret" aria-hidden="true" /> : null}
        </p>
        {answer.evidence.length ? (
          <div className="eb-row" aria-label="Sources">
            {answer.evidence.map((e, i) => (
              <button key={e.id} type="button" className="eb-pill" data-tone="outline" data-size="sm" onClick={() => openEvidence(e.id)} title={SOURCE_META[e.sourceType].label}>
                E{i + 1} · {e.title.length > 40 ? `${e.title.slice(0, 38)}…` : e.title}
              </button>
            ))}
          </div>
        ) : null}
        {answer.conflicts.length ? (
          <div className="eb-bento" data-tone="pink" style={{ padding: "8px 10px", borderRadius: 11 }} role="note">
            <b>Sources disagree.</b> {answer.conflicts.join(" ")}
          </div>
        ) : null}
        {!streaming && answer.actions.length ? (
          <div className="eb-row" aria-label="Suggested next steps">
            {answer.actions.map((a) =>
              a.kind === "open_source" ? (
                <PillLink key={a.id} tone="outline" href="/documents">
                  {a.label}
                </PillLink>
              ) : queued[a.id] ? (
                <PillLink key={a.id} tone="lime" href={`/approvals?focus=${queued[a.id]}`}>
                  <Icon name="check" size={12} /> In Approvals — view draft
                </PillLink>
              ) : (
                <PillButton key={a.id} tone="black" disabled={busy} onClick={() => accept(a)}>
                  {a.label}
                  {a.requiresApproval ? <span style={{ opacity: 0.7, fontWeight: 400 }}> · Needs approval</span> : null}
                </PillButton>
              ),
            )}
          </div>
        ) : null}
        {!streaming ? <Feedback question={answer.question} /> : null}
      </Bento>

      {lead ? (
        <Bento tone="lime" fill aria-label="Key figure" style={{ minHeight: 110 }}>
          <BentoHead title={lead.text} aside={<OriginTag view={lead.figure!.query ?? "finance"} />} />
          <div className="eb-big eb-num" title={formatINR(lead.figure!.amount)}>
            {formatINRShort(lead.figure!.amount)}
          </div>
          <p className="eb-note">
            <span className="eb-mono">{lead.figure!.query ?? "SQL view"}</span> {cite(lead.evidenceIds)}
          </p>
          <svg className="eb-ring-deco" width="150" height="150" viewBox="0 0 200 200" fill="none" stroke="#000" strokeWidth=".7" aria-hidden="true">
            <circle cx="100" cy="100" r="30" />
            <circle cx="100" cy="100" r="50" />
            <circle cx="100" cy="100" r="70" />
            <circle cx="100" cy="100" r="90" />
          </svg>
        </Bento>
      ) : null}

      <Grid cols="1fr 1fr" tight align="stretch">
        <Bento tone="black" fill aria-label="Confidence">
          <h2 className="eb-h">Confidence</h2>
          <div>
            <div className="eb-big-md eb-lime-text">{streaming ? "Checking…" : CONFIDENCE[answer.confidence.level]}</div>
            <p className="eb-note">
              {stats.cited} of {stats.claims} claims cited · {stats.sources} source{stats.sources === 1 ? "" : "s"}
            </p>
            {!streaming && answer.confidence.reason ? <p className="eb-note" style={{ marginTop: 4 }}>{answer.confidence.reason}</p> : null}
          </div>
        </Bento>
        <Bento tone="cream" aria-label="What I couldn't confirm">
          <h2 className="eb-h" style={{ marginBottom: 6 }}>
            What I couldn&apos;t confirm
          </h2>
          {answer.unknowns.length ? (
            <ul className="eb-body" style={{ paddingLeft: 15, margin: 0 }}>
              {answer.unknowns.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          ) : (
            <p className="eb-body">{streaming ? "Still checking…" : "Nothing open: every part of the question is covered by a source."}</p>
          )}
        </Bento>
      </Grid>

      {rows.length || answer.causes.length || answer.risks.length ? (
        <Bento tone="strong" span={2} aria-label="Breakdown">
          {rows.length ? (
            <>
              <BentoHead title="Over budget by package" aside={<span className="eb-note dim">₹ lakh</span>} />
              {rows.map((r, i) => (
                <BarRow key={r.id} label={r.label} value={<span title={formatINR(r.amount)}>{formatINRCompact(r.amount)}</span>} pct={r.pct} tone={i === 0 ? "lime" : i === 1 ? "black" : "lavender"} labelWidth={120} />
              ))}
            </>
          ) : null}
          {answer.causes.length ? (
            <div style={{ marginTop: rows.length ? 12 : 0 }}>
              <h3 className="eb-eyebrow" style={{ marginBottom: 4 }}>Why</h3>
              <ul className="eb-body" style={{ paddingLeft: 15, margin: 0 }}>
                {answer.causes.map((c) => (
                  <li key={c.id}>
                    {c.text}
                    {cite(c.evidenceIds)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {answer.risks.length ? (
            <div style={{ marginTop: 12 }}>
              <h3 className="eb-eyebrow" style={{ marginBottom: 4 }}>Risks</h3>
              <ul className="eb-body" style={{ paddingLeft: 15, margin: 0 }}>
                {answer.risks.map((r) => (
                  <li key={r.id}>
                    <Pill tone={r.severity === "high" ? "pink" : "cream"} size="sm">{r.severity}</Pill> {r.text}
                    {cite(r.evidenceIds)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Bento>
      ) : null}
    </Grid>
  );
}
