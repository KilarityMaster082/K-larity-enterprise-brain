"use client";
// Owner task: EB-53 Decision Memory with review UI — the two tiers: draft queue (Confirm / Edit / Reject) and the log.
import { Bento, BentoHead, Modal, Pill, PillButton, formatDate, formatINRShort, useToast } from "@klarity/ui";
import { useEffect, useMemo, useState, useTransition } from "react";

import { EvidenceLinks } from "@/components/evidence/EvidenceLinks";
import type { Evidence } from "@/lib/contracts";
import { reviewDecisionAction } from "@/lib/data/actions";
import type { Decision } from "@/lib/data/types";

export interface DecisionRow extends Decision {
  projectName: string;
  supersededByTitle?: string;
  evidence: Evidence[];
  /** Whether this person may review this draft (partners, owners, and the project lead). */
  canReview: boolean;
}

type Dialog = { kind: "edit" | "reject"; row: DecisionRow } | null;

export function DecisionsView({
  rows,
  triage,
  projects,
  focus,
  initialProject,
}: {
  rows: DecisionRow[];
  triage: { id: string; needsCare: boolean; reasons: string[] }[];
  projects: { id: string; name: string }[];
  focus?: string;
  initialProject?: string;
}) {
  const byId = new Map(rows.map((r) => [r.decisionId, r]));
  const drafts = triage.map((t) => ({ ...t, row: byId.get(t.id)! })).filter((t) => t.row?.status === "proposed");
  const [project, setProject] = useState(initialProject && projects.some((p) => p.id === initialProject) ? initialProject : "all");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pending, start] = useTransition();
  const toast = useToast();

  useEffect(() => {
    if (focus) document.getElementById(`dec-${focus}`)?.scrollIntoView({ block: "center" });
  }, [focus]);

  const log = useMemo(
    () =>
      rows
        .filter((r) => r.status !== "proposed" && (project === "all" || r.projectId === project))
        .sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? "")),
    [rows, project],
  );

  function act(row: DecisionRow, action: "confirm" | "reject" | "edit", input?: { title?: string; description?: string; note?: string }) {
    start(async () => {
      const res = await reviewDecisionAction(row.decisionId, action, input);
      if (res.ok) {
        toast(res.message ?? "Saved.");
        setDialog(null);
      } else toast(res.error, "danger");
    });
  }

  return (
    <div className="eb-stack">
      <Bento tone="cream" aria-labelledby="drafts-h">
        <h2 id="drafts-h" className="eb-eyebrow" style={{ marginBottom: 10 }}>
          Draft decisions · {drafts.length} to review
        </h2>
        {drafts.length ? (
          <div className="eb-stack tight">
            {drafts.map(({ row: r, needsCare, reasons }) => (
              <article key={r.decisionId} id={`dec-${r.decisionId}`} className="eb-draft" data-focus={r.decisionId === focus || undefined}>
                <div className="eb-grow">
                  <div className="eb-row" style={{ gap: 6 }}>
                    <h3 className="eb-h-lg" style={{ fontSize: "var(--eb-t-md)" }}>{r.title}</h3>
                    {needsCare ? <Pill tone="pink" size="sm" title={reasons.join(" · ")}>Look closely</Pill> : <Pill tone="green" size="sm">Clear</Pill>}
                  </div>
                  <p className="eb-li-sub">
                    {r.projectName}
                    {r.confidence !== undefined ? ` · extraction confidence ${Math.round(r.confidence * 100)}%` : ""}
                    {r.costImpact ? ` · stated impact ${r.costImpact > 0 ? "+" : ""}${formatINRShort(r.costImpact)} (from the source, not the ledger)` : ""}
                  </p>
                  {needsCare ? (
                    <ul className="eb-note" style={{ margin: "4px 0 0", paddingLeft: 15 }}>
                      {reasons.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div style={{ marginTop: 4 }}>
                    <EvidenceLinks evidence={r.evidence} citedFor={[r.title]} />
                  </div>
                </div>
                {r.canReview ? (
                  <div className="eb-row nowrap">
                    <PillButton tone="black" disabled={pending} onClick={() => act(r, "confirm")}>Confirm</PillButton>
                    <PillButton tone="outline" disabled={pending} onClick={() => setDialog({ kind: "edit", row: r })}>Edit</PillButton>
                    <PillButton tone="danger" disabled={pending} onClick={() => setDialog({ kind: "reject", row: r })}>Reject</PillButton>
                  </div>
                ) : (
                  <span className="eb-note dim">A project lead or partner reviews drafts.</span>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p className="eb-body">Nothing to review. New draft decisions found in messages and emails appear here.</p>
        )}
      </Bento>

      <Bento tone="strong" aria-label="Confirmed decision log">
        <BentoHead
          title="Confirmed decision log"
          eyebrow
          aside={
            <label className="eb-row" style={{ gap: 6, fontWeight: 400 }}>
              <span className="visually-hidden">Project</span>
              <select className="eb-input" style={{ width: "auto", minHeight: 26, padding: "3px 10px" }} value={project} onChange={(e) => setProject(e.target.value)} aria-label="Filter by project">
                <option value="all">All projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          }
        />
        {log.length ? (
          <ol className="eb-list" style={{ marginTop: 8 }}>
            {log.map((l) => (
              <li key={l.decisionId} id={`dec-${l.decisionId}`} className="eb-li" data-selected={l.decisionId === focus || undefined} style={{ flexWrap: "wrap" }}>
                <span className="eb-mono eb-dim" style={{ width: 66, flex: "none" }}>{l.decidedAt ? formatDate(l.decidedAt) : "—"}</span>
                <div className="eb-grow">
                  <span className="eb-li-title">{l.title}</span>
                  <div className="eb-li-sub">
                    {l.decidedBy ? `Decided by ${l.decidedBy}` : l.reviewedBy ? `Confirmed by ${l.reviewedBy}` : ""}
                    {l.rationale ? ` · ${l.rationale}` : ""}
                    {l.status === "superseded" && l.supersededByTitle ? ` · replaced by “${l.supersededByTitle}”` : ""}
                    {l.status === "revoked" ? " · rejected" : ""}
                  </div>
                </div>
                <Pill tone="lime" size="sm">{l.projectName}</Pill>
                {l.status === "superseded" ? <Pill size="sm">Superseded</Pill> : null}
                <EvidenceLinks evidence={l.evidence} citedFor={[l.title]} compact />
              </li>
            ))}
          </ol>
        ) : (
          <p className="eb-body" style={{ marginTop: 8 }}>No confirmed decisions for this project yet.</p>
        )}
      </Bento>

      <Modal open={dialog?.kind === "edit"} onClose={() => setDialog(null)} title="Edit and confirm decision">
        {dialog?.kind === "edit" ? (
          <form
            className="eb-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              act(dialog.row, "edit", { title: String(f.get("title")), description: String(f.get("description")), note: String(f.get("note") ?? "") });
            }}
          >
            <label className="eb-label">
              What was decided
              <input name="title" className="eb-input" defaultValue={dialog.row.title} required maxLength={200} />
            </label>
            <label className="eb-label">
              Details
              <textarea name="description" className="eb-input" rows={3} defaultValue={dialog.row.description} required maxLength={2000} />
            </label>
            <label className="eb-label">
              Review note <span className="eb-dim" style={{ fontWeight: 400 }}>optional</span>
              <input name="note" className="eb-input" maxLength={500} />
            </label>
            <div>
              <PillButton type="submit" tone="black" size="lg" disabled={pending}>Save and confirm</PillButton>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal open={dialog?.kind === "reject"} onClose={() => setDialog(null)} title="Reject this draft?">
        {dialog?.kind === "reject" ? (
          <form
            className="eb-stack"
            onSubmit={(e) => {
              e.preventDefault();
              act(dialog.row, "reject", { note: String(new FormData(e.currentTarget).get("note") ?? "") });
            }}
          >
            <p>“{dialog.row.title}” will not become part of the decision record.</p>
            <label className="eb-label">
              Why? <span className="eb-dim" style={{ fontWeight: 400 }}>helps improve extraction</span>
              <input name="note" className="eb-input" maxLength={500} placeholder="e.g. Only a suggestion, not agreed" />
            </label>
            <div>
              <PillButton type="submit" tone="black" size="lg" disabled={pending}>Reject draft</PillButton>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}
