"use client";
// Owner task: EB-53 Decision Memory with review UI — review queue and decision log.
import { Badge, EmptyState, formatDateTime, Modal, Money, TabPanel, Tabs, useToast } from "@klarity/ui";
import { useEffect, useMemo, useState, useTransition } from "react";

import { EvidenceLinks } from "@/components/evidence/EvidenceLinks";
import type { Evidence } from "@/lib/contracts";
import { reviewDecisionAction } from "@/lib/data/actions";
import type { Decision } from "@/lib/data/types";

export interface DecisionRow extends Decision {
  projectName: string;
  supersededByTitle?: string;
  evidence: Evidence[];
}

type Dialog = { kind: "edit" | "reject"; row: DecisionRow } | null;

export function DecisionsView({
  rows,
  projects,
  canReview,
  focus,
  initialProject,
}: {
  rows: DecisionRow[];
  projects: { id: string; name: string }[];
  canReview: boolean;
  focus?: string;
  initialProject?: string;
}) {
  const drafts = rows.filter((r) => r.status === "proposed");
  const focused = rows.find((r) => r.decisionId === focus);
  const [tab, setTab] = useState(focused && focused.status !== "proposed" ? "log" : drafts.length ? "review" : "log");
  const [project, setProject] = useState(initialProject && projects.some((p) => p.id === initialProject) ? initialProject : "all");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pending, start] = useTransition();
  const toast = useToast();

  useEffect(() => {
    if (focus) document.getElementById(`dec-${focus}`)?.scrollIntoView({ block: "center" });
  }, [focus, tab]);

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

  const card = (r: DecisionRow, review: boolean) => (
    <article key={r.decisionId} id={`dec-${r.decisionId}`} className="card review-card" data-focus={r.decisionId === focus}>
      <div className="row-between">
        <h3>{r.title}</h3>
        <span className="row">
          {r.status === "proposed" ? <Badge tone="info">Draft</Badge> : null}
          {r.status === "decided" ? <Badge tone="ok">Decided</Badge> : null}
          {r.status === "superseded" ? <Badge>Superseded</Badge> : null}
          {r.status === "revoked" ? <Badge tone="danger">Rejected</Badge> : null}
          {r.costImpact ? <Badge tone={r.costImpact > 0 ? "warn" : "ok"}>{r.costImpact > 0 ? "+" : ""}<Money amount={r.costImpact} /></Badge> : null}
        </span>
      </div>
      <p style={{ color: "var(--text-2)" }}>{r.description}</p>
      <dl className="kv">
        <dt>Project</dt>
        <dd>{r.projectName}</dd>
        {r.decidedBy ? (
          <>
            <dt>Decided by</dt>
            <dd>
              {r.decidedBy}
              {r.decidedAt ? ` · ${formatDateTime(r.decidedAt)}` : ""}
            </dd>
          </>
        ) : null}
        {r.rationale ? (
          <>
            <dt>Why</dt>
            <dd>{r.rationale}</dd>
          </>
        ) : null}
        {r.alternatives.length ? (
          <>
            <dt>Alternatives</dt>
            <dd>{r.alternatives.join("; ")}</dd>
          </>
        ) : null}
        {r.supersededByTitle ? (
          <>
            <dt>Replaced by</dt>
            <dd>{r.supersededByTitle}</dd>
          </>
        ) : null}
        {r.confidence !== undefined && r.status === "proposed" ? (
          <>
            <dt>Extraction confidence</dt>
            <dd>{Math.round(r.confidence * 100)}% — check the source before confirming</dd>
          </>
        ) : null}
        {r.reviewedBy ? (
          <>
            <dt>Reviewed by</dt>
            <dd>
              {r.reviewedBy}
              {r.reviewNote ? ` — “${r.reviewNote}”` : ""}
            </dd>
          </>
        ) : null}
      </dl>
      <EvidenceLinks evidence={r.evidence} citedFor={[r.title]} />
      {review ? (
        canReview ? (
          <div className="row">
            <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => act(r, "confirm")}>
              Confirm
            </button>
            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => setDialog({ kind: "edit", row: r })}>
              Edit & confirm
            </button>
            <button type="button" className="btn btn-danger btn-sm" disabled={pending} onClick={() => setDialog({ kind: "reject", row: r })}>
              Reject
            </button>
          </div>
        ) : (
          <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>
            A project lead or partner reviews drafts.
          </p>
        )
      ) : null}
    </article>
  );

  return (
    <>
      <Tabs
        label="Decisions"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "review", label: "To review", count: drafts.length },
          { id: "log", label: "Decision log" },
        ]}
      />
      <TabPanel id="review" active={tab === "review"}>
        {drafts.length ? (
          <div className="stack">{drafts.map((r) => card(r, true))}</div>
        ) : (
          <EmptyState icon="checkCircle" title="Nothing to review" compact>
            <p>New draft decisions found in messages and emails will appear here.</p>
          </EmptyState>
        )}
      </TabPanel>
      <TabPanel id="log" active={tab === "log"}>
        <div className="stack">
          <label className="field" style={{ maxWidth: 320 }}>
            Project
            <select className="select" value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="all">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {log.length ? log.map((r) => card(r, false)) : <p className="muted">No confirmed decisions for this project yet.</p>}
        </div>
      </TabPanel>

      <Modal open={dialog?.kind === "edit"} onClose={() => setDialog(null)} title="Edit and confirm decision">
        {dialog?.kind === "edit" ? (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              act(dialog.row, "edit", { title: String(f.get("title")), description: String(f.get("description")), note: String(f.get("note") ?? "") });
            }}
          >
            <label className="field">
              What was decided
              <input name="title" className="input" defaultValue={dialog.row.title} required maxLength={200} />
            </label>
            <label className="field">
              Details
              <textarea name="description" className="textarea" rows={3} defaultValue={dialog.row.description} required maxLength={2000} />
            </label>
            <label className="field">
              Review note <span className="field-hint">optional</span>
              <input name="note" className="input" maxLength={500} />
            </label>
            <div className="row">
              <button type="submit" className="btn btn-primary" disabled={pending}>
                Save and confirm
              </button>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal open={dialog?.kind === "reject"} onClose={() => setDialog(null)} title="Reject this draft?">
        {dialog?.kind === "reject" ? (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              act(dialog.row, "reject", { note: String(new FormData(e.currentTarget).get("note") ?? "") });
            }}
          >
            <p>“{dialog.row.title}” will not become part of the decision record.</p>
            <label className="field">
              Why? <span className="field-hint">helps improve extraction</span>
              <input name="note" className="input" maxLength={500} placeholder="e.g. Only a suggestion, not agreed" />
            </label>
            <div className="row">
              <button type="submit" className="btn btn-danger" disabled={pending}>
                Reject draft
              </button>
            </div>
          </form>
        ) : null}
      </Modal>
    </>
  );
}
