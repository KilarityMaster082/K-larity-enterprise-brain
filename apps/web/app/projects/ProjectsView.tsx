"use client";
// Owner task: EB-54 Project Brain page — filterable project cards. Tone follows health (pink off track, cream at risk,
// green/sky on track); the bar is forecast against budget, both from finance_project_summary.
import { Bento, Grid, Pill, PillButton } from "@klarity/ui";
import Link from "next/link";
import { useMemo, useState } from "react";

import { SqlMoney } from "@/components/finance/SqlMoney";
import { HealthBadge } from "@/components/page/common";
import type { Health } from "@/lib/data/derive";
import type { SqlFigure } from "@/lib/finance-sql";

export interface ProjectCard {
  projectId: string;
  name: string;
  code: string;
  client: string;
  location: string;
  stages: string[];
  currentStage: number;
  health: Health;
  reasons: string[];
  openDecisions: number;
  lead: string;
  dueOn: string;
  money: { budget: SqlFigure; forecast: SqlFigure; overrunPct: number } | null;
}

type Filter = "all" | "attention" | "on_track";
const TONE: Record<Health, "pink" | "cream" | "green"> = { off_track: "pink", at_risk: "cream", on_track: "green" };
const monthYear = (iso: string) => new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(`${iso}T00:00:00+05:30`));

export function ProjectsView({ cards, tenantId }: { cards: ProjectCard[]; tenantId: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return cards
      .filter((c) => (filter === "all" ? true : filter === "on_track" ? c.health === "on_track" : c.health !== "on_track"))
      .filter((c) => !needle || [c.name, c.client, c.location, c.code].some((x) => x.toLowerCase().includes(needle)));
  }, [cards, filter, q]);
  const attention = cards.filter((c) => c.health !== "on_track").length;
  const options: [Filter, string][] = [["all", `All (${cards.length})`], ["attention", `Needs attention (${attention})`], ["on_track", `On track (${cards.length - attention})`]];

  return (
    <div className="eb-stack">
      <div className="eb-row" style={{ justifyContent: "space-between" }}>
        <div className="eb-row" role="group" aria-label="Filter projects">
          {options.map(([k, label]) => (
            <PillButton key={k} active={filter === k} aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {label}
            </PillButton>
          ))}
        </div>
        <label className="eb-search" style={{ maxWidth: 260 }}>
          <span className="visually-hidden">Find a project</span>
          <input type="search" placeholder="Find a project" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      {shown.length === 0 ? <p className="eb-body" role="status">No projects match.</p> : null}
      <Grid cols="repeat(2, minmax(0, 1fr))" align="stretch">
        {shown.map((c) => {
          const pct = c.money ? (c.money.forecast.amount / Math.max(1, c.money.budget.amount)) * 100 : 0;
          return (
            <Bento key={c.projectId} tone={TONE[c.health]} fill className="eb-project" aria-label={c.name}>
              <div className="eb-row" style={{ justifyContent: "space-between" }}>
                <h2 className="eb-h-lg">
                  <Link href={`/projects/${c.projectId}`} className="eb-stretched">{c.name}</Link>
                </h2>
                <HealthBadge health={c.health} />
              </div>
              {c.money ? (
                <>
                  <div className="eb-big-md">
                    <SqlMoney figure={c.money.budget} tenantId={tenantId} /> <span className="eb-note" style={{ display: "inline" }}>budget</span>
                  </div>
                  <div>
                    <div className="eb-row" style={{ justifyContent: "space-between", fontSize: "var(--eb-t-xs)", marginBottom: 4 }}>
                      <span>Forecast <SqlMoney figure={c.money.forecast} tenantId={tenantId} /></span>
                      <span className="eb-num">{Math.round(pct)}%</span>
                    </div>
                    <div className="eb-track" role="img" aria-label={`Forecast is ${Math.round(pct)}% of budget`}>
                      <div className="eb-fill" style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                  </div>
                </>
              ) : (
                <p className="eb-body">{c.stages[c.currentStage]} · stage {c.currentStage + 1} of {c.stages.length}. Budget is visible to partners and owners.</p>
              )}
              <div className="eb-row" style={{ fontSize: "var(--eb-t-xs)", marginTop: "auto" }}>
                <span>Target {monthYear(c.dueOn)}</span>
                <span>Lead: {c.lead}</span>
                <span className="eb-auto">{c.reasons.length} open risk{c.reasons.length === 1 ? "" : "s"}</span>
                {c.openDecisions ? <Pill tone="black" size="sm">{c.openDecisions} decision{c.openDecisions > 1 ? "s" : ""} to review</Pill> : null}
              </div>
            </Bento>
          );
        })}
      </Grid>
    </div>
  );
}
