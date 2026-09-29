"use client";
// Owner task: EB-66 Approval model skeleton (UI) — pending queue and history.
import { Badge, EmptyState, formatDateTime, formatRelative, Modal, TabPanel, Tabs, useToast } from "@klarity/ui";
import { useEffect, useState, useTransition } from "react";

import { EvidenceLinks } from "@/components/evidence/EvidenceLinks";
import type { Evidence } from "@/lib/contracts";
import { decideApprovalAction } from "@/lib/data/actions";
import type { Approval } from "@/lib/data/types";

export interface ApprovalRow extends Approval {
  projectName?: string;
  evidence: Evidence[];
}

const KIND: Record<Approval["kind"], string> = {
  draft_message: "Message draft",
  create_task: "Task",
  update_record: "Record update",
};

export function ApprovalsView({ rows, canDecide, focus }: { rows: ApprovalRow[]; canDecide: boolean; focus?: string }) {
  const pending = rows.filter((r) => r.status === "pending");
  const done = rows.filter((r) => r.status !== "pending");
  const [tab, setTab] = useState(done.some((r) => r.approvalId === focus) ? "done" : "pending");
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [rejecting, setRejecting] = useState<ApprovalRow | null>(null);
  const [busy, start] = useTransition();
  const toast = useToast();

  useEffect(() => {
    if (focus) document.getElementById(`apr-${focus}`)?.scrollIntoView({ block: "center" });
  }, [focus, tab]);

  function decide(r: ApprovalRow, decision: "approve" | "reject", note: string) {
    start(async () => {
      const res = await decideApprovalAction(r.approvalId, decision, note, editing[r.approvalId]);
      if (res.ok) {
        toast(res.message ?? "Saved.");
        setRejecting(null);
      } else toast(res.error, "danger");
    });
  }

  const card = (r: ApprovalRow) => {
    const isEditing = r.status === "pending" && editing[r.approvalId] !== undefined; // decided drafts show as text
    return (
      <article key={r.approvalId} id={`apr-${r.approvalId}`} className="card review-card" data-focus={r.approvalId === focus}>
        <div className="row-between">
          <h3>{r.title}</h3>
          <span className="row">
            <Badge>{KIND[r.kind]}</Badge>
            {r.status === "approved" ? <Badge tone="ok">Approved</Badge> : null}
            {r.status === "rejected" ? <Badge tone="danger">Rejected</Badge> : null}
          </span>
        </div>
        <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>
          Requested by {r.requestedBy}
          {r.requestedVia === "ask_brain" ? " via Ask Brain" : r.requestedVia === "agent" ? " by an agent" : ""} ·{" "}
          <time dateTime={r.requestedAt} title={formatDateTime(r.requestedAt)}>
            {formatRelative(r.requestedAt)}
          </time>
          {r.projectName ? ` · ${r.projectName}` : ""}
        </p>
        <p>
          <strong>Why:</strong> {r.reason}
        </p>
        {isEditing ? (
          <label className="field">
            Draft (you can edit before approving)
            <textarea
              className="textarea"
              rows={6}
              maxLength={4000}
              value={editing[r.approvalId]}
              onChange={(e) => setEditing((x) => ({ ...x, [r.approvalId]: e.target.value }))}
            />
          </label>
        ) : (
          <div className="draft-body" aria-label="Draft">
            {r.body}
          </div>
        )}
        <EvidenceLinks evidence={r.evidence} citedFor={[r.reason]} />
        {r.status !== "pending" ? (
          <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>
            {r.status === "approved" ? "Approved" : "Rejected"} by {r.decidedBy}
            {r.decidedAt ? ` · ${formatDateTime(r.decidedAt)}` : ""}
            {r.note ? ` — “${r.note}”` : ""}
          </p>
        ) : canDecide ? (
          <div className="row">
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => decide(r, "approve", "")}>
              {isEditing ? "Approve edited draft" : "Approve"}
            </button>
            {isEditing ? (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  setEditing((x) => {
                    const { [r.approvalId]: _, ...rest } = x;
                    return rest;
                  })
                }
              >
                Cancel edit
              </button>
            ) : (
              <button type="button" className="btn btn-sm" onClick={() => setEditing((x) => ({ ...x, [r.approvalId]: r.body }))}>
                Edit draft
              </button>
            )}
            <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => setRejecting(r)}>
              Reject
            </button>
          </div>
        ) : (
          <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>
            Waiting for a partner or owner to approve.
          </p>
        )}
      </article>
    );
  };

  return (
    <>
      <Tabs
        label="Approvals"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "pending", label: "Waiting", count: pending.length },
          { id: "done", label: "History", count: done.length },
        ]}
      />
      <TabPanel id="pending" active={tab === "pending"}>
        {pending.length ? (
          <div className="stack">{pending.map(card)}</div>
        ) : (
          <EmptyState icon="checkCircle" title="No approvals waiting" compact>
            <p>Drafts suggested by Ask Brain or agents appear here. Nothing is sent until someone approves it.</p>
          </EmptyState>
        )}
      </TabPanel>
      <TabPanel id="done" active={tab === "done"}>
        {done.length ? <div className="stack">{done.map(card)}</div> : <p className="muted">No decisions yet.</p>}
      </TabPanel>

      <Modal open={Boolean(rejecting)} onClose={() => setRejecting(null)} title="Reject this request?">
        {rejecting ? (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              decide(rejecting, "reject", String(new FormData(e.currentTarget).get("note") ?? ""));
            }}
          >
            <p>“{rejecting.title}” will not be sent or created.</p>
            <label className="field">
              Reason <span className="field-hint">required — shown to the requester and kept in the audit log</span>
              <input name="note" className="input" required maxLength={500} />
            </label>
            <div className="row">
              <button type="submit" className="btn btn-danger" disabled={busy}>
                Reject
              </button>
            </div>
          </form>
        ) : null}
      </Modal>
    </>
  );
}
