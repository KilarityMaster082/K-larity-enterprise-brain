"use client";
// Owner task: EB-99 Session history and chat archive — search box and list (client: filters as you type).
import { Bento, Grid, Icon, Pill, formatPercent } from "@klarity/ui";
import Link from "next/link";
import { useMemo, useState } from "react";

import { fuzzyScore } from "@/lib/fuzzy";
import { shortWhen } from "@/lib/workspace";

interface Item {
  id: string;
  at: string;
  question: string;
  topic: string;
  projectId?: string;
  helpful?: boolean;
}

const TONES: Record<string, "lime" | "green" | "lavender" | "pink" | "sky"> = { Finance: "green", Decisions: "lavender", Drawings: "sky", All: "sky" };

export function HistoryView({
  items,
  stats,
  periodLabel,
  canFinance,
}: {
  items: Item[];
  stats: { thisPeriod: number; previous: number; helpfulPct?: number; rated: number };
  periodLabel: string;
  canFinance: boolean;
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const term = q.trim();
    const visible = items.filter((i) => canFinance || i.topic !== "Finance");
    return term ? visible.filter((i) => fuzzyScore(term, i.question) > 0 || fuzzyScore(term, i.topic) > 0) : visible;
  }, [items, q, canFinance]);
  const tone = (t: string) => `var(--eb-${TONES[t] ?? "lime"})`;

  return (
    <Grid cols="1fr 250px" align="start">
      <Bento tone="strong" aria-label="Past questions">
        <label className="eb-search" style={{ marginBottom: 12 }}>
          <Icon name="search" size={14} />
          <span className="visually-hidden">Search past questions</span>
          <input type="search" placeholder="Search past questions…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {shown.length ? (
          <ul className="eb-list">
            {shown.map((h) => (
              <li key={h.id}>
                <Link className="eb-li" href={`/ask?q=${encodeURIComponent(h.question)}${h.projectId ? `&project=${h.projectId}` : ""}`} title="Ask again">
                  <span className="eb-mono eb-dim" style={{ width: 58, flex: "none" }}>{shortWhen(h.at)}</span>
                  <span className="eb-li-title eb-grow">{h.question}</span>
                  <span className="eb-pill" data-size="sm" style={{ background: tone(h.topic) }}>{h.topic}</span>
                  {h.helpful === false ? <Pill tone="pink" size="sm">Not useful</Pill> : null}
                  <Icon name="external" size={12} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="eb-body" role="status">
            {items.length ? "No question matches your search." : "You have not asked anything yet. Questions you ask in Ask Brain are kept here."}
          </p>
        )}
      </Bento>
      <Bento tone="lime" fill>
        <h2 className="eb-h">Sessions {periodLabel === "this month" ? "this month" : `in ${periodLabel}`}</h2>
        <div className="eb-big eb-num">{stats.thisPeriod}</div>
        <p className="eb-note">
          {stats.thisPeriod >= stats.previous ? `${stats.thisPeriod - stats.previous} more` : `${stats.previous - stats.thisPeriod} fewer`} than the period before
        </p>
      </Bento>
      <Bento tone="black" fill style={{ gridColumn: "2" }}>
        <h2 className="eb-h">Helpful answers</h2>
        <div className="eb-big eb-lime-text">{stats.helpfulPct === undefined ? "—" : formatPercent(stats.helpfulPct, 0)}</div>
        <p className="eb-note">{stats.rated} rated</p>
      </Bento>
    </Grid>
  );
}
