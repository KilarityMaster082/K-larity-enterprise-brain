// Owner task: EB-106 Agents and background jobs — GET /api/agents/runs/[runId]: one run for the inspector drawer. Owners and
// partners only (agents.view), this tenant only; anything else is "not found".
import { NextResponse } from "next/server";

import { activeMembership, getSession } from "@/lib/auth/session";
import { tenantView } from "@/lib/data/store";
import { can } from "@/lib/permissions";
import { runLog, runStats } from "@/lib/workspace";

export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const m = activeMembership(session);
  if (!can(m.role, "agents.view")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { runId } = await ctx.params;
  const view = tenantView(m.tenantId, m.slug);
  for (const job of view.data.workspace.jobs) {
    const run = job.runs.find((r) => r.runId === runId.slice(0, 100));
    if (run) {
      return NextResponse.json({ job: { jobId: job.jobId, name: job.name, schedule: job.schedule, status: job.status }, run: { runId: run.runId, startedAt: run.startedAt, status: run.status, attempt: run.attempt }, log: runLog(job, run), stats: runStats(run, job.durationSec) }, { headers: { "cache-control": "no-store" } });
    }
  }
  return NextResponse.json({ error: "not found" }, { status: 404 });
}
