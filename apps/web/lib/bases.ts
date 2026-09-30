// Owner task: EB-104 Knowledge hub — Structured Bases: pure table logic (visible columns, filter, sort, CSV export). The CSV
// writer neutralises cells a spreadsheet could run as a formula (leading = + - @ tab or CR).
import type { BaseColumn, BaseTableData } from "./data/types";

export type Row = Record<string, string | number>;

export function filterRows(rows: Row[], query: string): Row[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => Object.values(r).some((v) => String(v).toLowerCase().includes(q)));
}

export function sortRows(rows: Row[], key: string | undefined, dir: "asc" | "desc"): Row[] {
  if (!key) return rows;
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (typeof x === "number" && typeof y === "number") return (x - y) * sign;
    return String(x ?? "").localeCompare(String(y ?? ""), "en-IN", { numeric: true }) * sign;
  });
}

export function csvCell(v: string | number | undefined): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(columns: BaseColumn[], rows: Row[]): string {
  return [columns.map((c) => csvCell(c.label)).join(","), ...rows.map((r) => columns.map((c) => csvCell(r[c.key])).join(","))].join("\r\n") + "\r\n";
}

export function tableOf(bases: BaseTableData[], id: string | undefined): BaseTableData | undefined {
  return bases.find((b) => b.baseId === id) ?? bases[0];
}
