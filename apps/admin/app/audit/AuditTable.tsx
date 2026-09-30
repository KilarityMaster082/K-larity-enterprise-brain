"use client";
// Owner task: EB-100 Admin console shell — filterable operator audit table.
import { DataTable, Pill, formatDateTime, type Column } from "@klarity/ui";

import type { OpAudit } from "@/lib/data";

export function AuditTable({ rows }: { rows: OpAudit[] }) {
  const cols: Column<OpAudit>[] = [
    { key: "at", header: "When", cell: (a) => formatDateTime(a.at), sort: (a) => a.at },
    { key: "operator", header: "Operator", cell: (a) => a.operator, sort: (a) => a.operator, text: (a) => `${a.operator} ${a.action} ${a.tenant ?? ""} ${a.reason ?? ""} ${a.detail ?? ""}` },
    {
      key: "action",
      header: "Action",
      cell: (a) => <Pill size="sm" tone={a.action.startsWith("impersonation") ? "lavender" : a.action.includes("suspend") ? "pink" : "outline"}>{a.action}</Pill>,
      sort: (a) => a.action,
    },
    { key: "tenant", header: "Tenant", cell: (a) => a.tenant ?? "—", sort: (a) => a.tenant ?? "" },
    { key: "reason", header: "Reason", cell: (a) => a.reason ?? "" },
    { key: "detail", header: "Detail", cell: (a) => a.detail ?? "" },
  ];
  return <DataTable rows={rows} columns={cols} rowKey={(a) => a.id} caption="Operator audit log" initialSort={{ key: "at", dir: "desc" }} searchPlaceholder="Filter the audit log" />;
}
