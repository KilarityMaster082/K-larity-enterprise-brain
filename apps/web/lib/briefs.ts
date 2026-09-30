// Owner task: EB-23 Web UI shell — the four-up brief row at the top of each screen group (three metrics and the Live
// card). Every value is derived from the tenant's rows and the caller's role: a role that may not see finance is shown
// other metrics, never a blank or a rounded guess.
import { formatINRCompact, formatNumber, formatPercent } from "@klarity/ui/format";

import { DEMO_NOW, executiveSummary, openReceivables, portfolio } from "./data/derive";
import type { TenantView } from "./data/store";
import type { Can } from "./workspace";
import { agentStats, appRows, historyStats, meetingsThisWeek, todoStats, upcomingDeadlines, visibleMail } from "./workspace";

export interface BriefMetric {
  label: string;
  value: string | number;
  note?: string;
  tone: "lime" | "sky" | "lavender" | "pink" | "green" | "cream";
  /** Real time series behind the number, when there is one; no series, no sparkline. */
  series?: number[];
}

const DAY = 864e5;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n)}`;

export function askBrief(view: TenantView): BriefMetric[] {
  const h = historyStats(view);
  const apps = appRows(view).filter((a) => a.liveStatus !== "available");
  return [
    { label: "Questions answered", value: h.thisPeriod, note: `${signed(h.thisPeriod - h.previous)} vs the 30 days before`, tone: "lime", series: h.weekly },
    { label: "Helpful answers", value: h.helpfulPct === undefined ? "—" : formatPercent(h.helpfulPct, 0), note: `${plural(h.rated, "answer")} rated`, tone: "sky" },
    { label: "Sources connected", value: view.sources.length, note: apps.map((a) => a.name).join(", ") || "None yet", tone: "lavender" },
  ];
}

export function commsBrief(view: TenantView, can: Can): BriefMetric[] {
  const threads = visibleMail(view, can);
  const today = threads.filter((t) => DEMO_NOW.getTime() - new Date(t.lastAt).getTime() < 2 * DAY).length;
  const drafts = view.data.decisions.filter((d) => d.status === "proposed").length;
  const found = threads.reduce((a, t) => a + t.extraction.decisions.length, 0);
  const deadlines = upcomingDeadlines(threads, 7);
  return [
    { label: "New in 48 hours", value: today, note: `of ${plural(threads.length, "thread")}`, tone: "sky" },
    { label: "Decisions found", value: found, note: `${drafts} waiting for review`, tone: "lime" },
    { label: "Deadlines", value: deadlines.length, note: "fall in the next 7 days", tone: "pink" },
  ];
}

export function workBrief(view: TenantView, can: Can): BriefMetric[] {
  const pending = view.approvals.filter((a) => a.status === "pending");
  const oldest = pending.length ? Math.max(...pending.map((a) => Math.floor((DEMO_NOW.getTime() - new Date(a.requestedAt).getTime()) / DAY))) : 0;
  const decisions = view.data.decisions.filter((d) => d.status === "proposed").length;
  const active = view.data.projects.filter((p) => p.status === "active").length;
  if (!can("finance.view")) {
    return [
      { label: "Active projects", value: active, note: "in this workspace", tone: "green" },
      { label: "Decisions to review", value: decisions, note: "drafts from email and chat", tone: "lime" },
      { label: "Approvals pending", value: pending.length, note: pending.length ? `oldest ${plural(oldest, "day")}` : "nothing waiting", tone: "cream" },
    ];
  }
  const s = executiveSummary(view.data);
  const worst = Math.max(0, ...openReceivables(view.data).map((r) => r.daysOverdue));
  return [
    { label: "Portfolio budget", value: formatINRCompact(portfolio(view.data).reduce((a, r) => a + r.finance.budget, 0)), note: `${plural(active, "active project")}`, tone: "green" },
    { label: "Overdue receivables", value: formatINRCompact(s.overdue), note: worst ? `${worst} days at worst` : "nothing overdue", tone: "pink" },
    { label: "Approvals pending", value: pending.length, note: pending.length ? `oldest ${plural(oldest, "day")}` : "nothing waiting", tone: "cream" },
  ];
}

export function meetBrief(view: TenantView): BriefMetric[] {
  const ws = view.data.workspace;
  const week = meetingsThisWeek(ws.meetings);
  const t = todoStats(ws.todos);
  return [
    { label: "Meetings this week", value: week.length, note: `${week.filter((m) => m.kind === "vendor" || m.kind === "client").length} with vendors or clients`, tone: "sky" },
    { label: "Commitments open", value: t.open, note: `${t.done} done`, tone: "lime" },
    { label: "Overdue", value: t.overdue, note: t.overdue ? "chase these first" : "all on time", tone: "pink" },
  ];
}

export function agentsBrief(view: TenantView): BriefMetric[] {
  const a = agentStats(view);
  return [
    { label: "Running now", value: a.running, note: `of ${a.total} scheduled`, tone: "lime" },
    { label: "Tokens today", value: a.tokens >= 1e6 ? `${(a.tokens / 1e6).toFixed(1)} M` : `${formatNumber(Math.round(a.tokens / 1e3))} K`, note: a.cap ? `${formatPercent(a.capPct, 0)} of the daily allowance` : "no allowance set", tone: "lavender" },
    { label: "Needs a nudge", value: a.needsNudge ? 1 : 0, note: a.needsNudge ? a.needsNudge.name : "all healthy", tone: "pink" },
  ];
}

export function viewersBrief(view: TenantView): BriefMetric[] {
  const ws = view.data.workspace;
  const drawings = view.data.documents.filter((d) => d.docType === "drawing" && d.isLatest).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const latest = drawings[0];
  const drive = view.sources.filter((s) => s.connectorType === "drive").reduce((a, s) => a + s.itemsSeen, 0);
  return [
    { label: "Files indexed", value: formatNumber(drive), note: "in Drive", tone: "sky" },
    { label: "Openable in place", value: ws.files.length, note: `${new Set(ws.files.map((f) => f.ext)).size} file types`, tone: "lime" },
    { label: "Last revision", value: latest ? `Rev ${latest.revision}` : "—", note: latest ? `${latest.series}, ${new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(latest.updatedAt))}` : "", tone: "lavender" },
  ];
}

export function appsBrief(view: TenantView): BriefMetric[] {
  const apps = appRows(view);
  const connected = apps.filter((a) => a.liveStatus !== "available").length;
  const members = view.members.filter((m) => m.status !== "disabled");
  const partners = members.filter((m) => m.role === "owner" || m.role === "admin").length;
  const guests = members.filter((m) => m.role === "guest").length;
  const r = view.data.workspace.retention;
  return [
    { label: "Connected", value: connected, note: `of ${apps.length} available`, tone: "green" },
    { label: "Members", value: members.length, note: `${plural(partners, "partner")}, ${plural(guests, "guest")}`, tone: "lavender" },
    { label: "Retention", value: r.days >= 365 ? `${+(r.days / 365).toFixed(1)} yrs` : `${r.days} days`, note: r.kmsKeyAlias ? `KMS key ${r.kmsKeyState}` : "no key yet", tone: "cream" },
  ];
}
