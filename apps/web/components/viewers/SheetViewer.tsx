"use client";
// Owner task: EB-102 File viewers — Spreadsheet viewer (screen 30): sheet tabs, frozen header row and first columns, a
// formula bar, and formulas evaluated here by lib/viewers/sheet.ts. Currency columns use lakh/crore grouping.
import { formatINR, formatNumber } from "@klarity/ui";
import { useMemo, useState } from "react";

import type { FileContent } from "@/lib/data/types";
import { colLetters, evaluateSheet, isError } from "@/lib/viewers/sheet";

type Xlsx = Extract<FileContent, { kind: "xlsx" }>;
const W = 132;

export function SheetViewer({ content }: { content: Xlsx }) {
  const [tab, setTab] = useState(0);
  const [sel, setSel] = useState<{ r: number; c: number } | null>(null);
  const sheet = content.sheets[tab] ?? content.sheets[0]!;
  const values = useMemo(() => evaluateSheet(sheet.rows), [sheet]);
  const money = new Set(sheet.currencyColumns ?? []);
  const cell = sel ? sheet.rows[sel.r]?.[sel.c] : undefined;
  const shown = (v: number | string, c: number) => (typeof v === "number" ? (money.has(c) ? formatINR(v) : formatNumber(v)) : v);

  return (
    <div>
      <div className="eb-formula-bar" aria-live="polite">
        <b className="eb-mono">{sel ? `${colLetters(sel.c)}${sel.r + 2}` : "—"}</b>
        <span className="eb-mono">{cell === undefined ? "Select a cell" : typeof cell === "object" ? cell.f : String(cell)}</span>
      </div>
      <div className="eb-sheet-scroll" role="region" aria-label={`Sheet ${sheet.name}`} tabIndex={0}>
        <table className="eb-sheet">
          <thead>
            <tr>
              {sheet.columns.map((h, c) => (
                <th key={c} scope="col" className={c < sheet.freezeCols ? "frozen" : undefined} style={c < sheet.freezeCols ? { left: c * W } : undefined}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, r) => (
              <tr key={r}>
                {sheet.columns.map((_, c) => {
                  const v = values[r]?.[c] ?? "";
                  const isSel = sel?.r === r && sel.c === c;
                  return (
                    <td
                      key={c}
                      className={[c < sheet.freezeCols ? "frozen" : "", typeof v === "number" ? "num" : "", isError(v) ? "err" : "", isSel ? "sel" : ""].join(" ").trim() || undefined}
                      style={c < sheet.freezeCols ? { left: c * W } : undefined}
                      onClick={() => setSel({ r, c })}
                      aria-selected={isSel || undefined}
                    >
                      {shown(v, c)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="eb-row" role="tablist" aria-label="Sheets" style={{ gap: 6, marginTop: 8 }}>
        {content.sheets.map((s, i) => (
          <button key={s.name} type="button" role="tab" aria-selected={i === tab} className="eb-pill" data-size="sm" data-active={i === tab || undefined} onClick={() => { setTab(i); setSel(null); }}>
            {s.name}
          </button>
        ))}
      </div>
    </div>
  );
}
