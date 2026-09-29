"use client";
// Owner task: EB-54 Project Brain page — budget vs committed per package, each row traceable to its invoices.
import { DataTable, formatINR, formatINRShort, Meter, Money, type Column } from "@klarity/ui";

import { EvidenceLinks } from "@/components/evidence/EvidenceLinks";
import type { Evidence } from "@/lib/contracts";
import type { PackageLine } from "@/lib/data/derive";

export function PackageTable({ lines, evidence }: { lines: PackageLine[]; evidence: Record<string, Evidence[]> }) {
  const columns: Column<PackageLine>[] = [
    { key: "package", header: "Package", cell: (l) => <strong>{l.package}</strong>, sort: (l) => l.package, text: (l) => l.package },
    { key: "budget", header: "Budget", numeric: true, cell: (l) => <Money amount={l.budget} />, sort: (l) => l.budget },
    { key: "committed", header: "Committed", numeric: true, cell: (l) => <Money amount={l.committed} />, sort: (l) => l.committed },
    {
      key: "overrun",
      header: "Over budget",
      numeric: true,
      cell: (l) => (l.overrun > 0 ? <Money amount={l.overrun} className="money-neg" /> : <span className="muted">—</span>),
      sort: (l) => l.overrun,
    },
    {
      key: "use",
      header: "Used",
      cell: (l) => (
        <div style={{ minWidth: 140 }}>
          <Meter value={l.committed} max={l.budget} label={`${l.package} committed against budget`} format={formatINRShort} />
        </div>
      ),
    },
    {
      key: "src",
      header: "Invoices",
      cell: (l) => <EvidenceLinks evidence={evidence[l.package] ?? []} citedFor={[`${l.package}: committed ${formatINR(l.committed)}`]} compact />,
    },
  ];
  return (
    <DataTable
      rows={lines}
      columns={columns}
      rowKey={(l) => l.package}
      caption="Budget vs committed by package"
      initialSort={{ key: "overrun", dir: "desc" }}
    />
  );
}
