"use client";
// Owner task: EB-105 Meetings and live notes — the todo list with checkboxes. Ticking writes through a server action that
// checks the role and records the change in the audit log.
import { Bento, Pill, formatDate, useToast } from "@klarity/ui";
import { useRouter } from "next/navigation";
import { useEffect, useOptimistic, useTransition } from "react";

import { EvidenceLinks } from "@/components/evidence/EvidenceLinks";
import type { Evidence } from "@/lib/contracts";
import { setTodoDoneAction } from "@/lib/data/actions";
import type { Todo } from "@/lib/data/types";

type Row = Todo & { project?: string; evidence: Evidence[]; overdue: boolean };

const SOURCE: Record<Todo["source"]["kind"], string> = { email: "Email", meeting: "Meeting", document: "Document", whatsapp: "WhatsApp" };

export function TodosView({ rows, canEdit, focus }: { rows: Row[]; canEdit: boolean; focus?: string }) {
  const [optimistic, setOptimistic] = useOptimistic(rows, (state, patch: { id: string; done: boolean }) => state.map((r) => (r.todoId === patch.id ? { ...r, done: patch.done, overdue: patch.done ? false : r.overdue } : r)));
  const [, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  useEffect(() => {
    if (focus) document.getElementById(`td-${focus}`)?.scrollIntoView({ block: "center" });
  }, [focus]);

  function toggle(r: Row) {
    start(async () => {
      setOptimistic({ id: r.todoId, done: !r.done });
      const res = await setTodoDoneAction(r.todoId, !r.done);
      if (!res.ok) toast(res.error, "danger");
      router.refresh();
    });
  }

  const open = optimistic.filter((r) => !r.done).sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.dueOn ?? "9").localeCompare(b.dueOn ?? "9"));
  const done = optimistic.filter((r) => r.done);

  const item = (r: Row) => (
    <li key={r.todoId} id={`td-${r.todoId}`} className="eb-li" data-selected={r.todoId === focus || undefined} style={{ padding: "11px 0" }}>
      <input
        type="checkbox"
        className="eb-check"
        checked={r.done}
        disabled={!canEdit}
        onChange={() => toggle(r)}
        aria-label={`${r.done ? "Reopen" : "Mark done"}: ${r.text}`}
      />
      <div className="eb-grow">
        <span className="eb-li-title" style={{ textDecoration: r.done ? "line-through" : undefined, opacity: r.done ? 0.6 : 1 }}>{r.text}</span>
        {r.project ? <div className="eb-li-sub">{r.project}</div> : null}
      </div>
      <Pill size="sm">{r.assignee}</Pill>
      <span className="eb-mono" style={{ width: 70, textAlign: "right", color: r.overdue ? "var(--eb-danger)" : "var(--eb-muted-2)" }}>
        {r.done ? "Done" : r.overdue ? "Overdue" : r.dueOn ? formatDate(`${r.dueOn}T00:00:00+05:30`) : "—"}
      </span>
      <span className="eb-row nowrap" style={{ gap: 4 }}>
        <Pill tone="black" size="sm">{SOURCE[r.source.kind]}</Pill>
        <EvidenceLinks evidence={r.evidence} citedFor={[r.text]} compact />
      </span>
    </li>
  );

  return (
    <Bento tone="strong" aria-label="Commitments">
      <h2 className="eb-h" style={{ marginBottom: 8 }}>Commitments extracted across email, meetings and documents</h2>
      {open.length ? <ul className="eb-list" aria-label="Open">{open.map(item)}</ul> : <p className="eb-body">Nothing open in this period.</p>}
      {done.length ? (
        <details style={{ marginTop: 10 }}>
          <summary className="eb-note" style={{ cursor: "pointer" }}>{done.length} done</summary>
          <ul className="eb-list" aria-label="Done">{done.map(item)}</ul>
        </details>
      ) : null}
    </Bento>
  );
}
