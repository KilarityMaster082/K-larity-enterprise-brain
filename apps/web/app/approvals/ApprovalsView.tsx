"use client";
// Owner task: EB-66 Approval model skeleton (UI) — the queue (pending first) and history. Approve / Edit / Reject with a
// mandatory rejection reason kept in the audit log. Approving in development sends nothing; production hands the
// approved draft to the approved action.
import { Bento, Pill, PillButton, formatDateTime, formatRelative, useToast } from "@klarity/ui";
import { useEffect, useRef, useState, useTransition } from "react";

import { EvidenceLinks } from "@/components/evidence/EvidenceLinks";
import type { Evidence } from "@/lib/contracts";
import { decideApprovalAction } from "@/lib/data/actions";
import type { Approval } from "@/lib/data/types";

export interface ApprovalRow extends Approval {
  projectName?: string;
  evidence: Evidence[];
}

const KIND: Record<Approval["kind"], string> = { draft_message: "Message draft", create_task: "Task", update_record: "Record update" };
const toneFor = (r: ApprovalRow): "pink" | "cream" | "sky" => (/payment|reminder|overdue/i.test(r.title) ? "pink" : /variation|claim|change/i.test(r.title) ? "cream" : "sky");

export function ApprovalsView({ rows, canDecide, focus }: { rows: ApprovalRow[]; canDecide: boolean; focus?: string }) {
  const pending = rows.filter((r) => r.status === "pending");
  const done = rows.filter((r) => r.status !== "pending");
  const [showDone, setShowDone] = useState(done.some((r) => r.approvalId === focus));
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [busy, start] = useTransition();
  const toast = useToast();
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focus) document.getElementById(`apr-${focus}`)?.scrollIntoView({ block: "center" });
  }, [focus, showDone]);

  function decide(r: ApprovalRow, decision: "approve" | "reject") {
    if (decision === "reject" && !reason.trim()) {
      toast("Add a reason before rejecting: it is kept in the audit log.", "danger");
      reasonRef.current?.focus();
      return;
    }
    start(async () => {
      const res = await decideApprovalAction(r.approvalId, decision, decision === "reject" ? reason : "", editing[r.approvalId]);
      if (res.ok) {
        toast(res.message ?? "Saved.");
        if (decision === "reject") setReason("");
      } else toast(res.error, "danger");
    });
  }

  const card = (r: ApprovalRow) => {
    const isEditing = r.status === "pending" && editing[r.approvalId] !== undefined;
    return (
      <Bento key={r.approvalId} tone={r.status === "pending" ? toneFor(r) : "glass"} id={`apr-${r.approvalId}`} aria-label={r.title} className="eb-draft" style={{ display: "block" }} data-focus={r.approvalId === focus || undefined}>
        <div className="eb-row" style={{ justifyContent: "space-between" }}>
          <h2 className="eb-h-lg">{r.title}</h2>
          <span className="eb-row" style={{ gap: 5 }}>
            <Pill size="sm">{KIND[r.kind]}</Pill>
            {r.status === "pending" ? <Pill>Needs approval</Pill> : r.status === "approved" ? <Pill tone="green">Approved</Pill> : <Pill tone="pink">Rejected</Pill>}
          </span>
        </div>
        <p className="eb-li-sub" style={{ marginTop: 4 }}>
          Requested by {r.requestedBy}
          {r.requestedVia === "ask_brain" ? " via Ask Brain" : r.requestedVia === "agent" ? " by an agent" : ""} ·{" "}
          <time dateTime={r.requestedAt} title={`${formatDateTime(r.requestedAt)} IST`}>{formatRelative(r.requestedAt)}</time>
          {r.projectName ? ` · ${r.projectName}` : ""}
        </p>
        <p className="eb-body" style={{ margin: "6px 0" }}>
          <b>Why:</b> {r.reason}
        </p>
        {isEditing ? (
          <label className="eb-label">
            Draft (edit before approving)
            <textarea className="eb-input" rows={6} maxLength={4000} value={editing[r.approvalId]} onChange={(e) => setEditing((x) => ({ ...x, [r.approvalId]: e.target.value }))} />
          </label>
        ) : (
          <pre className="eb-draft-body" aria-label="Draft">{r.body}</pre>
        )}
        <div className="eb-row" style={{ marginTop: 8 }}>
          {r.status === "pending" && canDecide ? (
            <>
              <PillButton tone="black" disabled={busy} onClick={() => decide(r, "approve")}>{isEditing ? "Approve edited draft" : "Approve"}</PillButton>
              {isEditing ? (
                <PillButton onClick={() => setEditing(({ [r.approvalId]: _, ...rest }) => rest)}>Cancel edit</PillButton>
              ) : (
                <PillButton onClick={() => setEditing((x) => ({ ...x, [r.approvalId]: r.body }))}>Edit</PillButton>
              )}
              <PillButton tone="danger" disabled={busy} onClick={() => decide(r, "reject")}>Reject</PillButton>
            </>
          ) : r.status === "pending" ? (
            <span className="eb-note">Waiting for a partner or owner to approve.</span>
          ) : (
            <span className="eb-note">
              {r.status === "approved" ? "Approved" : "Rejected"} by {r.decidedBy}
              {r.decidedAt ? ` · ${formatDateTime(r.decidedAt)} IST` : ""}
              {r.note ? ` — “${r.note}”` : ""}
            </span>
          )}
          <span className="eb-auto eb-row" style={{ gap: 4 }}>
            <span className="eb-note">Evidence: {r.evidence.length} source{r.evidence.length === 1 ? "" : "s"}</span>
            <EvidenceLinks evidence={r.evidence} citedFor={[r.reason]} compact />
          </span>
        </div>
      </Bento>
    );
  };

  return (
    <div className="eb-grid" style={{ ["--cols" as string]: "1fr 290px", alignItems: "start" }}>
      <div className="eb-stack">
        {pending.length ? pending.map(card) : <Bento tone="green"><h2 className="eb-h">No approvals waiting</h2><p className="eb-body">Drafts suggested by Ask Brain or agents appear here. Nothing is sent until someone approves it.</p></Bento>}
        <div>
          <PillButton tone="outline" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}>
            History ({done.length}) {showDone ? "▴" : "▾"}
          </PillButton>
        </div>
        {showDone ? (done.length ? done.map(card) : <p className="eb-body">No decisions yet.</p>) : null}
      </div>
      <div className="eb-stack">
        <Bento tone="black" aria-label="Rejection reason">
          <label htmlFor="reject-reason" className="eb-h" style={{ display: "block" }}>Rejection reason</label>
          <textarea
            id="reject-reason"
            ref={reasonRef}
            className="eb-input"
            style={{ marginTop: 10, background: "#262626", color: "#eee", border: 0 }}
            rows={4}
            maxLength={500}
            placeholder="Required when rejecting…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={!canDecide}
          />
        </Bento>
        <Bento tone="lime" aria-label="How approvals work">
          <p className="eb-body"><b>Nothing leaves without a person.</b> Every action is audited with who asked, why and the evidence behind it.</p>
        </Bento>
      </div>
    </div>
  );
}
