// Owner task: EB-105 Meetings and live notes — Action Todos & Commitments Hub (screen 23): the commitments extracted from
// email, meetings and documents in one list. Each has an assignee, a deadline and the source it came from; ticking one is
// audited. The period control limits open items to those due within the window (overdue items always show).
import { Bento, BentoHead, Grid, ProgressTrack } from "@klarity/ui";
import type { Metadata } from "next";

import { NoAccess } from "@/components/page/common";
import { Brief, Screen, presenceOf } from "@/components/page/Screen";
import { meetBrief } from "@/lib/briefs";
import { DEMO_NOW } from "@/lib/data/derive";
import { evidenceById } from "@/lib/data/store";
import { pageContext } from "@/lib/page";
import { parsePeriod, periodDays } from "@/lib/period";
import { projectName, todoStats } from "@/lib/workspace";

import { TodosView } from "./TodosView";

export const metadata: Metadata = { title: "Todos" };

export default async function TodosPage({ searchParams }: { searchParams: Promise<{ period?: string; focus?: string }> }) {
  const ctx = await pageContext("/todos", "todos.view");
  if (!ctx.allowed) return <NoAccess what="todos" />;
  const sp = await searchParams;
  const days = periodDays(parsePeriod(sp.period));
  const { view, session } = ctx;
  const todos = view.data.workspace.todos;
  const stats = todoStats(todos);
  const horizon = DEMO_NOW.getTime() + days * 864e5;
  const rows = todos
    .filter((t) => t.done || !t.dueOn || new Date(`${t.dueOn}T23:59:00+05:30`).getTime() <= horizon)
    .map((t) => ({ ...t, project: t.projectId ? projectName(view, t.projectId) : undefined, evidence: evidenceById(view, t.source.evidenceId ? [t.source.evidenceId] : []), overdue: !t.done && Boolean(t.dueOn) && new Date(`${t.dueOn}T23:59:00+05:30`).getTime() < DEMO_NOW.getTime() }));
  const total = stats.open + stats.done;
  return (
    <Screen n={23} brief={<Brief metrics={meetBrief(view)} live={presenceOf(view.members, session.user)} />}>
      <Grid cols="1fr 290px" align="start">
        <TodosView rows={rows} canEdit={ctx.member.role !== "viewer"} focus={sp.focus} />
        <div className="eb-stack">
          <Bento tone="lime" aria-label="Done">
            <BentoHead title="Done" />
            <div className="eb-big" style={{ marginTop: 8 }}>{stats.done}<span className="eb-big-md"> of {total}</span></div>
            <div style={{ marginTop: 10 }}><ProgressTrack pct={total ? (stats.done / total) * 100 : 0} label={`${stats.done} of ${total} commitments done`} /></div>
          </Bento>
          <Bento tone="pink" aria-label="Overdue">
            <BentoHead title="Overdue" />
            <div className="eb-big" style={{ marginTop: 8 }}>{stats.overdue}</div>
            <p className="eb-note">{stats.overdue ? "Chase these first" : "Everything is on time"}</p>
          </Bento>
        </div>
      </Grid>
    </Screen>
  );
}
