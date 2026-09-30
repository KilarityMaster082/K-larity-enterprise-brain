"use client";
// Owner task: EB-55 Financial Brain page — sortable, filterable finance tables with source drill-downs. Every amount is
// a SqlFigure rendered by SqlMoney, so a number without a reviewed SQL origin cannot be drawn.
import { Bento, DataTable, formatDate, formatPercent, Pill, type Column } from "@klarity/ui";
import Link from "next/link";

import { EvidenceLinks } from "@/components/evidence/EvidenceLinks";
import { SqlMoney } from "@/components/finance/SqlMoney";
import type { Evidence } from "@/lib/contracts";
import type { SqlFigure } from "@/lib/finance-sql";

export interface RecvRow { id: string; ref: string; client: string; project: string; projectId: string; amount: SqlFigure; due: string; daysOverdue: number; ageDays: number; evidence: Evidence[] }
export interface PayRow { id: string; ref: string; vendor: string; project: string; pkg: string; amount: SqlFigure; due: string; evidence: Evidence[] }
export interface VarRow { projectId: string; project: string; budget: SqlFigure; committed: SqlFigure; forecast: SqlFigure; overrun: SqlFigure; overrunPct: number }
export interface LeakRow { id: string; title: string; detail: string; project: string; amount: SqlFigure; kind: string; evidence: Evidence[] }

const KIND_LABEL: Record<string, string> = {
  unsigned_variation: "Unsigned variation",
  cost_not_billed: "Cost not billed",
  duplicate_invoice: "Possible duplicate",
};

export function FinanceTables({ tenantId, recv, pay, variance, leaks, payWindow }: { tenantId: string; recv: RecvRow[]; pay: PayRow[]; variance: VarRow[]; leaks: LeakRow[]; payWindow: string }) {
  const money = (f: SqlFigure) => <SqlMoney figure={f} tenantId={tenantId} />;
  const recvCols: Column<RecvRow>[] = [
    { key: "ref", header: "Invoice", cell: (r) => <strong>{r.ref}</strong>, sort: (r) => r.ref, text: (r) => `${r.ref} ${r.client} ${r.project}` },
    { key: "client", header: "Client", cell: (r) => r.client, sort: (r) => r.client },
    { key: "project", header: "Project", cell: (r) => <Link className="cell-link" href={`/projects/${r.projectId}`}>{r.project}</Link>, sort: (r) => r.project },
    { key: "due", header: "Due", cell: (r) => formatDate(r.due), sort: (r) => r.due },
    {
      key: "late",
      header: "Status",
      cell: (r) => (r.daysOverdue > 0 ? <Pill tone={r.daysOverdue > 30 ? "pink" : "cream"} size="sm">{r.daysOverdue} days overdue</Pill> : <Pill tone="green" size="sm">Not due · {r.ageDays} d old</Pill>),
      sort: (r) => r.daysOverdue,
    },
    { key: "amount", header: "Amount", numeric: true, cell: (r) => money(r.amount), sort: (r) => r.amount.amount },
    { key: "src", header: "Source", cell: (r) => <EvidenceLinks evidence={r.evidence} citedFor={[`${r.ref} outstanding`]} compact /> },
  ];
  const payCols: Column<PayRow>[] = [
    { key: "ref", header: "Invoice", cell: (r) => <strong>{r.ref}</strong>, sort: (r) => r.ref, text: (r) => `${r.ref} ${r.vendor} ${r.project} ${r.pkg}` },
    { key: "vendor", header: "Vendor", cell: (r) => r.vendor, sort: (r) => r.vendor },
    { key: "project", header: "Project", cell: (r) => r.project, sort: (r) => r.project },
    { key: "pkg", header: "Package", cell: (r) => r.pkg, sort: (r) => r.pkg },
    { key: "due", header: "Due", cell: (r) => formatDate(r.due), sort: (r) => r.due },
    { key: "amount", header: "Amount", numeric: true, cell: (r) => money(r.amount), sort: (r) => r.amount.amount },
    { key: "src", header: "Source", cell: (r) => <EvidenceLinks evidence={r.evidence} citedFor={[`${r.ref} payable`]} compact /> },
  ];
  const varCols: Column<VarRow>[] = [
    { key: "project", header: "Project", cell: (r) => <Link className="cell-link" href={`/projects/${r.projectId}`}>{r.project}</Link>, sort: (r) => r.project, text: (r) => r.project },
    { key: "budget", header: "Budget", numeric: true, cell: (r) => money(r.budget), sort: (r) => r.budget.amount },
    { key: "committed", header: "Committed", numeric: true, cell: (r) => money(r.committed), sort: (r) => r.committed.amount },
    { key: "forecast", header: "Forecast", numeric: true, cell: (r) => money(r.forecast), sort: (r) => r.forecast.amount },
    {
      key: "overrun",
      header: "Over budget",
      numeric: true,
      cell: (r) => (r.overrun.amount > 0 ? <span className="eb-danger">+{money(r.overrun)} ({formatPercent(r.overrunPct)})</span> : <span className="eb-dim">—</span>),
      sort: (r) => r.overrun.amount,
    },
  ];
  return (
    <div className="eb-stack">
      <Bento tone="strong" id="receivables" aria-labelledby="recv-h">
        <h2 id="recv-h" className="eb-eyebrow" style={{ marginBottom: 8 }}>Overdue and upcoming client payments</h2>
        <DataTable rows={recv} columns={recvCols} rowKey={(r) => r.id} caption="Open receivables" initialSort={{ key: "late", dir: "desc" }} searchPlaceholder="Filter by invoice, client or project" empty="No open receivables." />
      </Bento>

      <Bento tone="strong" id="leakage" aria-labelledby="leak-h">
        <h2 id="leak-h" className="eb-eyebrow" style={{ marginBottom: 8 }}>Possible revenue leakage</h2>
        {leaks.length ? (
          <ul className="eb-list">
            {leaks.map((l) => (
              <li key={l.id} className="eb-li" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
                <div className="eb-grow">
                  <div className="eb-row">
                    <strong>{l.title}</strong>
                    <Pill tone="cream" size="sm">{KIND_LABEL[l.kind] ?? l.kind}</Pill>
                    <span className="eb-dim">{l.project}</span>
                  </div>
                  <p className="eb-note dim">{l.detail}</p>
                  <EvidenceLinks evidence={l.evidence} citedFor={[l.title]} />
                </div>
                <strong>{money(l.amount)}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p className="eb-body">No leakage flags. The checks look for unsigned variations, change orders not billed on and duplicate invoices.</p>
        )}
      </Bento>

      <Bento tone="strong" id="variance" aria-labelledby="var-h">
        <h2 id="var-h" className="eb-eyebrow" style={{ marginBottom: 8 }}>Budget variance by project</h2>
        <DataTable rows={variance} columns={varCols} rowKey={(r) => r.projectId} caption="Budget variance by project" initialSort={{ key: "overrun", dir: "desc" }} />
      </Bento>

      <Bento tone="strong" id="payables" aria-labelledby="pay-h">
        <h2 id="pay-h" className="eb-eyebrow" style={{ marginBottom: 8 }}>Vendor payables due {payWindow}</h2>
        <DataTable rows={pay} columns={payCols} rowKey={(r) => r.id} caption={`Payables due ${payWindow}`} initialSort={{ key: "due", dir: "asc" }} searchPlaceholder="Filter by vendor, project or package" empty={`Nothing due ${payWindow}.`} />
      </Bento>
    </div>
  );
}
