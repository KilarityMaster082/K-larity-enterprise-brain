"use client";
// Owner task: EB-104 Knowledge hub — structured base table: tabs, filter, sortable columns, column chooser, CSV export.
import { Bento, Pill, PillButton, formatINR } from "@klarity/ui";
import { useMemo, useState } from "react";

import { filterRows, sortRows, toCsv } from "@/lib/bases";
import type { BaseTableData } from "@/lib/data/types";

const STATUS_TONE: Record<string, "lime" | "pink" | "cream"> = { Active: "lime", Dispute: "pink", Review: "cream" };

export function BasesView({ bases, initialBase, initialQuery }: { bases: BaseTableData[]; initialBase?: string; initialQuery?: string }) {
  const [baseId, setBaseId] = useState(bases.find((b) => b.baseId === initialBase)?.baseId ?? bases[0]?.baseId);
  const [q, setQ] = useState(initialQuery ?? "");
  const [sort, setSort] = useState<{ key?: string; dir: "asc" | "desc" }>({ dir: "asc" });
  const [hidden, setHidden] = useState<Record<string, string[]>>({});
  const base = bases.find((b) => b.baseId === baseId);

  const cols = useMemo(() => (base ? base.columns.filter((c) => !(hidden[base.baseId] ?? []).includes(c.key)) : []), [base, hidden]);
  const rows = useMemo(() => (base ? sortRows(filterRows(base.rows, q), sort.key, sort.dir) : []), [base, q, sort]);

  if (!base) return <Bento tone="strong"><p className="eb-body">No structured data yet.</p></Bento>;

  function exportCsv() {
    const blob = new Blob([toCsv(cols, rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${base!.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const cell = (c: BaseTableData["columns"][number], v: string | number | undefined) => {
    if (c.kind === "rating") {
      const n = Number(v ?? 0);
      return (
        <span className="eb-row nowrap" title={`${n} of 5`} style={{ gap: 6 }}>
          <span className="eb-track thin" style={{ width: 70 }} role="img" aria-label={`Rating ${n} of 5`}><span className="eb-fill" style={{ display: "block", width: `${(n / 5) * 100}%` }} /></span>
          <span className="eb-num">{n.toFixed(1)}</span>
        </span>
      );
    }
    if (c.kind === "status") return <Pill tone={STATUS_TONE[String(v)] ?? "outline"} size="sm">{String(v)}</Pill>;
    if (c.kind === "money") return <span className="eb-num">{formatINR(Number(v))}</span>;
    return <>{v ?? "—"}</>;
  };

  return (
    <Bento tone="strong" aria-label="Structured bases">
      <div className="eb-row" style={{ marginBottom: 12 }}>
        {bases.map((b) => (
          <PillButton key={b.baseId} active={b.baseId === baseId} aria-pressed={b.baseId === baseId} onClick={() => { setBaseId(b.baseId); setSort({ dir: "asc" }); }}>
            {b.name}
          </PillButton>
        ))}
        <label className="eb-search eb-auto" style={{ width: 200 }}>
          <span className="visually-hidden">Filter rows</span>
          <input type="search" placeholder="Filter rows…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <details className="eb-menu">
          <summary className="eb-pill" data-tone="outline" style={{ cursor: "pointer" }}>Columns</summary>
          <div className="eb-menu-pop" role="group" aria-label="Choose columns">
            {base.columns.map((c) => (
              <label key={c.key} className="eb-menu-item">
                <input
                  type="checkbox"
                  checked={!(hidden[base.baseId] ?? []).includes(c.key)}
                  disabled={cols.length === 1 && !(hidden[base.baseId] ?? []).includes(c.key)}
                  onChange={(e) => setHidden((h) => ({ ...h, [base.baseId]: e.target.checked ? (h[base.baseId] ?? []).filter((k) => k !== c.key) : [...(h[base.baseId] ?? []), c.key] }))}
                />{" "}
                {c.label}
              </label>
            ))}
          </div>
        </details>
        <PillButton tone="outline" onClick={exportCsv}>Export CSV ↓</PillButton>
      </div>
      <div className="eb-scroll-x">
        <table className="eb-table">
          <caption className="visually-hidden">{base.name}</caption>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                  <button type="button" className="eb-linklike" style={{ font: "inherit", letterSpacing: "inherit", textTransform: "inherit", color: "inherit", fontWeight: 700 }} onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key && s.dir === "asc" ? "desc" : "asc" }))}>
                    {c.label} {sort.key === c.key ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {cols.map((c, ci) => (
                  <td key={c.key} className={c.kind === "money" || c.kind === "number" ? "r" : undefined}>{ci === 0 ? <b>{cell(c, r[c.key])}</b> : cell(c, r[c.key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="eb-body" role="status">No rows match.</p> : null}
      </div>
    </Bento>
  );
}
