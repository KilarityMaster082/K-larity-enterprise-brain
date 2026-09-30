// Owner task: EB-106 Agents and background jobs — Background Agents & Jobs Monitor (screen 24). Owners and partners only.
// What runs in the background (syncs, audits, re-indexing, knowledge gardening), when it last ran and how it is doing. A row
// opens the run inspector (?run=, screen 25). Agents draft, they never act: anything with a side effect goes to Approvals.
import { Bento, Grid } from "@klarity/ui";
import type { Metadata } from "next";

import { NoAccess } from "@/components/page/common";
import { Brief, Screen, presenceOf } from "@/components/page/Screen";
import { agentsBrief } from "@/lib/briefs";
import { pageContext } from "@/lib/page";
import { agentStats } from "@/lib/workspace";

import { JobList } from "./JobList";

export const metadata: Metadata = { title: "Background agents" };

export default async function TasksPage() {
  const ctx = await pageContext("/tasks", "agents.view");
  if (!ctx.allowed) return <NoAccess what="background agents" />;
  const { view, session } = ctx;
  const stats = agentStats(view);
  const jobs = view.data.workspace.jobs;
  return (
    <Screen n={24} brief={<Brief metrics={agentsBrief(view)} live={presenceOf(view.members, session.user)} />}>
      <Grid cols="repeat(3, minmax(0, 1fr))" align="stretch">
        <Bento tone="lime" fill aria-label="Running now"><h2 className="eb-h">Running now</h2><div className="eb-big">{stats.running}</div></Bento>
        <Bento tone="black" fill aria-label="Runs today"><h2 className="eb-h">Runs today</h2><div className="eb-big">{stats.ranToday}</div></Bento>
        <Bento tone="pink" fill aria-label="Failed or retrying"><h2 className="eb-h">Failed, retrying</h2><div className="eb-big">{jobs.filter((j) => j.status === "retrying" || j.status === "failed").length}</div></Bento>
        <Bento tone="strong" span={3} aria-label="Jobs">
          <JobList jobs={jobs.map((j) => ({ jobId: j.jobId, name: j.name, description: j.description, schedule: j.schedule, status: j.status, durationSec: j.durationSec, latestRunId: j.runs[0]?.runId }))} />
        </Bento>
      </Grid>
    </Screen>
  );
}
