"use client";
// Owner task: EB-55 Financial Brain page — sortable, filterable finance tables with source drill-downs.
import { Badge, Card, DataTable, formatDate, formatPercent, Money, type Column } from "@klarity/ui";
import Link from "next/link";

import { EvidenceLinks } from "@/components/evidence/EvidenceLinks";
import type { Evidence } from "@/lib/contracts";

export interface RecvRow { id: string; ref: string; client: string; project: string; projectId: string; amount: number; due: string; daysOverdue: number; evidence: Evidence[] }
export interface PayRow { id: string; ref: string; vendor: string; project: string; pkg: string; amount: number; due: string; evidence: Evidence[] }
export interface VarRow { projectId: string; project: string; budget: number; committed: number; forecast: number; overrun: number; overrunPct: number }
export interface LeakRow { id: string; title: string; detail: string; project: string; amount: number; kind: string; evidence: Evidence[] }

const KIND_LABEL: Record<string, string> = {
  unsigned_variation: "Unsigned variation",
  cost_not_billed: "Cost not billed",
  duplicate_invoice: "Possible duplicate",
};

export function FinanceTables({ recv, pay, variance, leaks }: { recv: RecvRow[]; pay: PayRow[]; variance: VarRow[]; leaks: LeakRow[] }) {
  const recvCols: Column<RecvRow>[] = [
    { key: "ref", header: "Invoice", cell: (r) => <strong>{r.ref}</strong>, sort: (r) => r.ref, text: (r) => `${r.ref} ${r.client} ${r.project}` },
    { key: "client", header: "Client", cell: (r) => r.client, sort: (r) => r.client },
    { key: "project", header: "Project", cell: (r) => <Link className="cell-link" href={`/projects/${r.projectId}`}>{r.project}</Link>, sort: (r) => r.project },
    { key: "due", header: "Due", cell: (r) => formatDate(r.due), sort: (r) => r.due },
    {
      key: "late",
      header: "Status",
      cell: (r) => (r.daysOverdue > 0 ? <Badge tone={r.daysOverdue > 30 ? "danger" : "warn"}>{r.daysOverdue} days overdue</Badge> : <Badge tone="ok">Not due</Badge>),
      sort: (r) => r.daysOverdue,
    },
    { key: "amount", header: "Amount", numeric: true, cell: (r) => <Money amount={r.amount} />, sort: (r) => r.amount },
    { key: "src", header: "Source", cell: (r) => <EvidenceLinks evidence={r.evidence} citedFor={[`${r.ref} outstanding`]} compact /> },
  ];
  const payCols: Column<PayRow>[] = [
    { key: "ref", header: "Invoice", cell: (r) => <strong>{r.ref}</strong>, sort: (r) => r.ref, text: (r) => `${r.ref} ${r.vendor} ${r.project} ${r.pkg}` },
    { key: "vendor", header: "Vendor", cell: (r) => r.vendor, sort: (r) => r.vendor },
    { key: "project", header: "Project", cell: (r) => r.project, sort: (r) => r.project },
    { key: "pkg", header: "Package", cell: (r) => r.pkg, sort: (r) => r.pkg },
    { key: "due", header: "Due", cell: (r) => formatDate(r.due), sort: (r) => r.due },
    { key: "amount", header: "Amount", numeric: true, cell: (r) => <Money amount={r.amount} />, sort: (r) => r.amount },
    { key: "src", header: "Source", cell: (r) => <EvidenceLinks evidence={r.evidence} citedFor={[`${r.ref} payable`]} compact /> },
  ];
  const varCols: Column<VarRow>[] = [
    { key: "project", header: "Project", cell: (r) => <Link className="cell-link" href={`/projects/${r.projectId}`}>{r.project}</Link>, sort: (r) => r.project, text: (r) => r.project },
    { key: "budget", header: "Budget", numeric: true, cell: (r) => <Money amount={r.budget} />, sort: (r) => r.budget },
    { key: "committed", header: "Committed", numeric: true, cell: (r) => <Money amount={r.committed} />, sort: (r) => r.committed },
    { key: "forecast", header: "Forecast", numeric: true, cell: (r) => <Money amount={r.forecast} />, sort: (r) => r.forecast },
    {
      key: "overrun",
      header: "Over budget",
      numeric: true,
      cell: (r) => (r.overrun > 0 ? <span className="money-neg">+<Money amount={r.overrun} /> ({formatPercent(r.overrunPct)})</span> : <span className="muted">—</span>),
      sort: (r) => r.overrun,
    },
  ];
  return (
    <>
      <Card title="Overdue and upcoming client payments" id="receivables">
        <DataTable rows={recv} columns={recvCols} rowKey={(r) => r.id} caption="Open receivables" initialSort={{ key: "late", dir: "desc" }} searchPlaceholder="Filter by invoice, client or project" empty="No open receivables." />
      </Card>

      <Card title="Possible revenue leakage" id="leakage">
        {leaks.length ? (
          <ul className="list-plain stack">
            {leaks.map((l) => (
              <li key={l.id} className="stack-sm">
                <div className="row-between">
                  <strong>{l.title}</strong>
                  <Money amount={l.amount} />
                </div>
                <span className="row">
                  <Badge tone="warn">{KIND_LABEL[l.kind] ?? l.kind}</Badge>
                  <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                    {l.project}
                  </span>
                </span>
                <p style={{ fontSize: "var(--fs-sm)", color: "var(--text-2)" }}>{l.detail}</p>
                <EvidenceLinks evidence={l.evidence} citedFor={[l.title]} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No leakage flags. The checks look for unsigned variations, change orders not billed on and duplicate invoices.</p>
        )}
      </Card>

      <Card title="Budget variance by project" id="variance">
        <DataTable rows={variance} columns={varCols} rowKey={(r) => r.projectId} caption="Budget variance by project" initialSort={{ key: "overrun", dir: "desc" }} />
      </Card>

      <Card title="Vendor payables due in the next 30 days" id="payables">
        <DataTable rows={pay} columns={payCols} rowKey={(r) => r.id} caption="Payables due in 30 days" initialSort={{ key: "due", dir: "asc" }} searchPlaceholder="Filter by vendor, project or package" empty="Nothing due in the next 30 days." />
      </Card>
    </>
  );
}
