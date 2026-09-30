"use client";
// Owner task: EB-102 File viewers — Code & config diff viewer (screen 37): unified or side-by-side line diff of what changed.
// Reaching it needs code.view (technical roles); the route enforces that, this only renders.
import { PillButton } from "@klarity/ui";
import { useMemo, useState } from "react";

import type { FileContent } from "@/lib/data/types";
import { diffLines, diffStats } from "@/lib/viewers/diff";

export function CodeViewer({ content }: { content: Extract<FileContent, { kind: "code" }> }) {
  const [split, setSplit] = useState(false);
  const d = useMemo(() => diffLines(content.before, content.after), [content]);
  const s = diffStats(d);
  const mark = { add: "+", del: "−", same: " " } as const;
  return (
    <div>
      <div className="eb-row" style={{ gap: 8, marginBottom: 8 }}>
        <b className="eb-mono eb-grow">{content.path}</b>
        <span className="eb-mono" style={{ color: "#1f6b2c" }}>+{s.added}</span>
        <span className="eb-mono" style={{ color: "var(--eb-danger)" }}>−{s.removed}</span>
        <PillButton size="sm" tone="outline" onClick={() => setSplit(!split)} aria-pressed={split}>{split ? "Unified" : "Side by side"}</PillButton>
      </div>
      {split ? (
        <div className="eb-diff eb-diff-split" role="table" aria-label="Side-by-side diff">
          {d.map((l, i) => (
            <div key={i} role="row" className="eb-diff-row">
              <code role="cell" data-kind={l.kind === "add" ? "same" : l.kind}>{l.kind === "add" ? "" : l.text}</code>
              <code role="cell" data-kind={l.kind === "del" ? "same" : l.kind}>{l.kind === "del" ? "" : l.text}</code>
            </div>
          ))}
        </div>
      ) : (
        <div className="eb-diff" role="table" aria-label="Diff">
          {d.map((l, i) => (
            <div key={i} role="row" className="eb-diff-row" data-kind={l.kind}>
              <span role="cell" className="eb-diff-no">{l.oldNo ?? ""}</span>
              <span role="cell" className="eb-diff-no">{l.newNo ?? ""}</span>
              <code role="cell"><span aria-label={l.kind === "add" ? "added" : l.kind === "del" ? "removed" : "unchanged"}>{mark[l.kind]}</span> {l.text}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
