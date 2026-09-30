"use client";
// Owner task: EB-29 Temporal ingestion pipeline — the dead-letter rows with an expandable stack trace and the Replay / Dismiss
// dialogs. Both need a written reason and are audited by the server action; replay reuses the item's idempotency key.
import { Modal, Pill, formatDateTime, formatRelative, useToast } from "@klarity/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { dismissDeadLetterAction, replayDeadLetterAction } from "@/lib/actions";

export interface DlqRow {
  id: string;
  tenant: string;
  sourceId: string;
  itemRef: string;
  stage: string;
  errorType: string;
  errorMessage: string;
  stack: string;
  attemptCount: number;
  idempotencyKey: string;
  payloadRef?: string;
  failedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionNotes?: string;
}

export function DeadLetterList({ rows }: { rows: DlqRow[] }) {
  const [dialog, setDialog] = useState<{ row: DlqRow; kind: "replay" | "dismiss" } | null>(null);
  const [busy, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  if (!rows.length) return <p className="eb-body">Nothing in the queue for this filter.</p>;
  return (
    <>
      <ul className="eb-list" aria-label="Dead-letter items">
        {rows.map((d) => (
          <li key={d.id} style={{ borderTop: "1px solid var(--eb-line)" }}>
            <details>
              <summary className="eb-li" style={{ cursor: "pointer", listStyle: "none" }}>
                <Pill size="sm" tone="black">{d.stage}</Pill>
                <span className="eb-grow" style={{ minWidth: 0 }}>
                  <span className="eb-li-title eb-trunc" style={{ display: "block" }}>{d.itemRef}</span>
                  <span className="eb-li-sub">{d.tenant} · {d.sourceId} · {d.errorType}</span>
                </span>
                <span className="eb-mono eb-dim" title={formatDateTime(d.failedAt)}>{formatRelative(d.failedAt)}</span>
                <Pill size="sm" tone={d.attemptCount >= 4 ? "pink" : "cream"}>{d.attemptCount} attempt{d.attemptCount === 1 ? "" : "s"}</Pill>
                {d.resolvedAt ? <Pill size="sm" tone="green">resolved</Pill> : null}
              </summary>
              <div className="eb-stack" style={{ padding: "4px 4px 14px" }}>
                <p className="eb-body"><b>{d.errorType}:</b> {d.errorMessage}</p>
                <pre className="eb-stack-trace" tabIndex={0} aria-label="Stack trace">{d.stack}</pre>
                <dl className="eb-kv">
                  <dt>Idempotency key</dt><dd className="eb-mono" style={{ wordBreak: "break-all" }}>{d.idempotencyKey}</dd>
                  {d.payloadRef ? (<><dt>Payload</dt><dd className="eb-mono" style={{ wordBreak: "break-all" }}>{d.payloadRef}</dd></>) : null}
                  {d.resolvedAt ? (<><dt>Resolved</dt><dd>{d.resolvedBy} · {formatDateTime(d.resolvedAt)}</dd><dt>Notes</dt><dd>{d.resolutionNotes}</dd></>) : null}
                </dl>
                {!d.resolvedAt ? (
                  <div className="eb-row" style={{ gap: 8 }}>
                    <button type="button" className="eb-pill" data-tone="black" onClick={() => setDialog({ row: d, kind: "replay" })}>Replay</button>
                    <button type="button" className="eb-pill" data-tone="outline" onClick={() => setDialog({ row: d, kind: "dismiss" })}>Dismiss</button>
                  </div>
                ) : null}
              </div>
            </details>
          </li>
        ))}
      </ul>
      <Modal open={Boolean(dialog)} onClose={() => setDialog(null)} title={dialog?.kind === "replay" ? "Replay this item?" : "Dismiss this item?"}>
        {dialog ? (
          <form
            className="eb-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const reason = String(new FormData(e.currentTarget).get("reason"));
              start(async () => {
                const r = await (dialog.kind === "replay" ? replayDeadLetterAction : dismissDeadLetterAction)(dialog.row.id, reason);
                if (r.ok) {
                  toast(r.message ?? "Done.");
                  setDialog(null);
                  router.refresh();
                } else toast(r.error, "danger");
              });
            }}
          >
            <p className="eb-body">
              {dialog.kind === "replay"
                ? `${dialog.row.itemRef} for ${dialog.row.tenant} runs again at the ${dialog.row.stage} stage under the same idempotency key, so nothing can be ingested twice.`
                : `${dialog.row.itemRef} stays in the audit log but leaves the open queue. It will not be retried.`}
            </p>
            <label className="field">
              Reason <span className="field-hint">recorded in the audit log</span>
              <textarea name="reason" className="textarea" rows={2} required minLength={10} maxLength={300} />
            </label>
            <div className="eb-row">
              <button type="submit" className="eb-pill" data-tone="black" disabled={busy}>{dialog.kind === "replay" ? "Replay" : "Dismiss"}</button>
            </div>
          </form>
        ) : null}
      </Modal>
    </>
  );
}
