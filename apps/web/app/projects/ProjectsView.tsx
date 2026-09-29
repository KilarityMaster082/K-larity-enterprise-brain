"use client";
// Owner task: EB-54 Project Brain page — filterable project cards.
import { Badge, formatINRShort, Meter, Segmented, Stepper } from "@klarity/ui";
import Link from "next/link";
import { useMemo, useState } from "react";

import { HealthBadge } from "@/components/page/common";
import type { Health } from "@/lib/data/derive";

export interface ProjectCard {
  projectId: string;
  name: string;
  code: string;
  client: string;
  location: string;
  status: string;
  stages: string[];
  currentStage: number;
  health: Health;
  reasons: string[];
  openDecisions: number;
  money: { budget: number; forecast: number; overdue: number } | null;
}

type Filter = "all" | "attention" | "on_track";

export function ProjectsView({ cards }: { cards: ProjectCard[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return cards
      .filter((c) => (filter === "all" ? true : filter === "on_track" ? c.health === "on_track" : c.health !== "on_track"))
      .filter((c) => !needle || [c.name, c.client, c.location, c.code].some((x) => x.toLowerCase().includes(needle)));
  }, [cards, filter, q]);
  const attention = cards.filter((c) => c.health !== "on_track").length;

  return (
    <div className="stack">
      <div className="row-between">
        <Segmented<Filter>
          label="Filter projects"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: `All (${cards.length})` },
            { value: "attention", label: `Needs attention (${attention})` },
            { value: "on_track", label: `On track (${cards.length - attention})` },
          ]}
        />
        <input
          type="search"
          className="input input-search"
          style={{ maxWidth: 280 }}
          placeholder="Find a project"
          aria-label="Find a project"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {shown.length === 0 ? (
        <p className="muted" role="status">
          No projects match.
        </p>
      ) : null}
      <div className="grid-2">
        {shown.map((c) => (
          <Link key={c.projectId} href={`/projects/${c.projectId}`} className="card card-link project-card">
            <div className="row-between">
              <h2>{c.name}</h2>
              <HealthBadge health={c.health} />
            </div>
            <div className="project-meta">
              <span>{c.client}</span>
              <span>{c.location}</span>
              {c.openDecisions ? <Badge tone="info">{c.openDecisions} decision{c.openDecisions > 1 ? "s" : ""} to review</Badge> : null}
            </div>
            <Stepper steps={c.stages} current={c.currentStage} label={`${c.name} stage: ${c.stages[c.currentStage]}`} />
            {c.money ? (
              <Meter value={c.money.forecast} max={c.money.budget} label="Forecast against budget" format={formatINRShort} />
            ) : null}
            {c.reasons.length ? (
              <ul className="list-bullets" style={{ fontSize: "var(--fs-sm)", color: "var(--text-2)" }}>
                {c.reasons.slice(0, 3).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : (
              <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                No issues found in the ledger or open items.
              </p>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
