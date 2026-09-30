"use client";
// Owner task: EB-106 Agents and background jobs — the job rows. Status is shown by colour, word and motion together; a row
// opens the run inspector over this page.
import { Pill } from "@klarity/ui";

import { useOverlay } from "@/components/overlays/useOverlay";
import type { AgentStatus } from "@/lib/data/types";
import { mmss } from "@/lib/meetings";

interface Job {
  jobId: string;
  name: string;
  description: string;
  schedule: string;
  status: AgentStatus;
  durationSec: number;
  latestRunId?: string;
}

const LOOK: Record<AgentStatus, { dot: string; anim: string; label: string; tone: "lime" | "green" | "pink" | "cream" | "outline" }> = {
  running: { dot: "#2b8a3e", anim: "eb-pulse 1.6s infinite", label: "Running", tone: "lime" },
  ok: { dot: "#888", anim: "none", label: "Done", tone: "green" },
  retrying: { dot: "#b42318", anim: "eb-blink 1s infinite", label: "Retrying", tone: "pink" },
  failed: { dot: "#b42318", anim: "none", label: "Failed", tone: "pink" },
  queued: { dot: "#e0a800", anim: "none", label: "Queued", tone: "cream" },
};

export function JobList({ jobs }: { jobs: Job[] }) {
  const open = useOverlay();
  return (
    <ul className="eb-list" aria-label="Background jobs">
      {jobs.map((j) => {
        const l = LOOK[j.status];
        return (
          <li key={j.jobId}>
            <button type="button" className="eb-li" disabled={!j.latestRunId} onClick={() => j.latestRunId && open("run", j.latestRunId)} aria-label={`${j.name}: ${l.label}. Open the latest run`} style={{ padding: "11px 4px" }}>
              <span style={{ width: 11, height: 11, borderRadius: "50%", background: l.dot, animation: l.anim, flex: "none" }} aria-hidden="true" />
              <b className="eb-trunc" style={{ width: 200, flex: "none" }}>{j.name}</b>
              <span className="eb-grow eb-dim eb-trunc">{j.description}</span>
              <span className="eb-mono eb-dim" style={{ width: 92, flex: "none" }}>{j.schedule}</span>
              <span className="eb-mono" style={{ width: 62, flex: "none" }}>{mmss(j.durationSec).slice(3)}</span>
              <Pill tone={l.tone} size="sm">{l.label}</Pill>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
