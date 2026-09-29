"use client";
// Owner task: EB-39 Measure: ingestion freshness and error dashboard — sortable table across tenants.
import { Badge, DataTable, formatDateTime, formatNumber, formatPercent, formatRelative, type Column } from "@klarity/ui";
import Link from "next/link";

export interface HealthRow {
  sourceId: string;
  name: string;
  type: string;
  health: string;
  lastSyncAt: string;
  lagMinutes: number;
  itemsPerDay: number;
  errorRate: number;
  deadLetters: number;
  tenant: string;
  tenantId: string;
}

const target = (r: HealthRow) => (r.type === "gmail" || r.type === "whatsapp" ? 5 : 60);

function lag(min: number): string {
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} days`;
}

export function SourcesTable({ rows }: { rows: HealthRow[] }) {
  const cols: Column<HealthRow>[] = [
    { key: "tenant", header: "Tenant", cell: (r) => <Link className="cell-link" href={`/tenants/${r.tenantId}`}>{r.tenant}</Link>, sort: (r) => r.tenant, text: (r) => `${r.tenant} ${r.name} ${r.type} ${r.health}` },
    { key: "name", header: "Source", cell: (r) => <span>{r.name} <span className="muted">({r.type})</span></span>, sort: (r) => r.name },
    {
      key: "health",
      header: "Health",
      cell: (r) => <Badge tone={r.health === "ok" ? "ok" : r.health === "degraded" ? "warn" : "danger"}>{r.health}</Badge>,
      sort: (r) => (r.health === "ok" ? 2 : r.health === "degraded" ? 1 : 0),
    },
    { key: "last", header: "Last sync", cell: (r) => <time title={formatDateTime(r.lastSyncAt)}>{formatRelative(r.lastSyncAt)}</time>, sort: (r) => r.lastSyncAt },
    {
      key: "lag",
      header: "Lag",
      numeric: true,
      cell: (r) => <span className={r.lagMinutes > target(r) ? "over-target" : undefined} title={`Target ≤ ${target(r)} min`}>{lag(r.lagMinutes)}</span>,
      sort: (r) => r.lagMinutes / target(r),
    },
    { key: "items", header: "Items / day", numeric: true, cell: (r) => formatNumber(r.itemsPerDay), sort: (r) => r.itemsPerDay },
    {
      key: "err",
      header: "Error rate",
      numeric: true,
      cell: (r) => <span className={r.errorRate >= 0.02 ? "over-target" : undefined}>{formatPercent(r.errorRate)}</span>,
      sort: (r) => r.errorRate,
    },
    { key: "dead", header: "Dead letters", numeric: true, cell: (r) => <span className={r.deadLetters ? "over-target" : undefined}>{r.deadLetters}</span>, sort: (r) => r.deadLetters },
  ];
  return <DataTable rows={rows} columns={cols} rowKey={(r) => `${r.tenantId}-${r.sourceId}`} caption="Sources health across tenants" initialSort={{ key: "health", dir: "asc" }} searchPlaceholder="Filter by tenant, source or status" empty="No sources connected in any tenant." />;
}
