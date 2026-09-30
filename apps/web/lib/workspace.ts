// Owner task: EB-23 Web UI shell — what each workspace screen shows, derived from the tenant's own rows and the
// caller's role. Pure functions, no I/O, unit-tested in tests/workspace.test.ts. Like lib/data/derive.ts these never
// invent a figure: counts and amounts come from the rows (and, for money, from derive.ts).
import { DEMO_NOW, leakageFlags, openReceivables, portfolio } from "./data/derive";
import type { TenantView } from "./data/store";
import type { AppDef, ActivityItem, MailThread, Meeting, Source, Todo } from "./data/types";
import type { Capability } from "./permissions";

export type Can = (cap: Capability) => boolean;

const DAY = 864e5;
const at = (iso: string) => new Date(iso).getTime();

// ---------------------------------------------------------------- communications
/** Threads that quote money are hidden from roles that may not see finance (permission checked before retrieval). */
export function visibleMail(view: TenantView, can: Can): MailThread[] {
  return view.data.workspace.mail.filter((t) => !t.financial || can("finance.view")).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

export function mailFolders(threads: MailThread[]): { inbox: number; unread: number; starred: number; sent: number } {
  return {
    inbox: threads.filter((t) => t.folder === "inbox").length,
    unread: threads.filter((t) => t.folder === "inbox" && t.unread).length,
    starred: threads.filter((t) => t.starred).length,
    sent: threads.filter((t) => t.folder === "sent").length,
  };
}

/** Commitments due from today onwards within `days`, across every visible thread. */
export function upcomingDeadlines(threads: MailThread[], days = 7, now = DEMO_NOW): { text: string; due: string; threadId: string }[] {
  const limit = now.getTime() + days * DAY;
  return threads
    .flatMap((t) => t.extraction.commitments.map((c) => ({ ...c, threadId: t.threadId })))
    .filter((c) => at(`${c.due}T23:59:00+05:30`) >= now.getTime() && at(`${c.due}T00:00:00+05:30`) <= limit)
    .sort((a, b) => a.due.localeCompare(b.due));
}

// ---------------------------------------------------------------- knowledge
export function knowledgeSets(view: TenantView): { name: string; count: number; tone: "sky" | "lavender" | "green" | "pink" }[] {
  const items = (t: Source["connectorType"]) => view.sources.filter((s) => s.connectorType === t).reduce((a, s) => a + s.itemsSeen, 0);
  const drawings = view.data.documents.filter((d) => d.docType === "drawing").length;
  return [
    { name: "Emails", count: items("gmail"), tone: "sky" },
    { name: "Drawings", count: drawings, tone: "lavender" },
    { name: "WhatsApp messages", count: items("whatsapp"), tone: "green" },
    { name: "Spreadsheets", count: items("sheets"), tone: "pink" },
  ];
}

/** Active jobs of a contractor = projects where the ledger still has an open payable for them. */
export function contractorJobs(view: TenantView, name: string): number {
  const open = view.data.txns.filter((t) => t.direction === "payable" && t.status === "pending" && t.counterparty.toLowerCase().includes(name.toLowerCase()));
  return new Set(open.map((t) => t.projectId)).size;
}

export function folderTree(view: TenantView): { folderId: string; name: string; depth: number; children: number; files: number }[] {
  const { folders, files } = view.data.workspace;
  const out: { folderId: string; name: string; depth: number; children: number; files: number }[] = [];
  const walk = (parent: string | undefined, depth: number) => {
    for (const f of folders.filter((x) => x.parentId === parent)) {
      out.push({ folderId: f.folderId, name: f.name, depth, children: folders.filter((x) => x.parentId === f.folderId).length, files: files.filter((x) => x.folderId === f.folderId).length });
      walk(f.folderId, depth + 1);
    }
  };
  walk(undefined, 0);
  return out;
}

// ---------------------------------------------------------------- meetings & todos
export function meetingsByDay(meetings: Meeting[]): { day: string; items: Meeting[] }[] {
  const days = new Map<string, Meeting[]>();
  for (const m of [...meetings].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const day = m.startsAt.slice(0, 10);
    days.set(day, [...(days.get(day) ?? []), m]);
  }
  return [...days].map(([day, items]) => ({ day, items }));
}

export function meetingsThisWeek(meetings: Meeting[], now = DEMO_NOW): Meeting[] {
  return meetings.filter((m) => m.status !== "past" && at(m.startsAt) >= now.getTime() - 2 * 3600e3 && at(m.startsAt) < now.getTime() + 7 * DAY);
}

export function todoStats(todos: Todo[], now = DEMO_NOW): { open: number; done: number; overdue: number; doneThisWeek: number } {
  const open = todos.filter((t) => !t.done);
  return {
    open: open.length,
    done: todos.length - open.length,
    overdue: open.filter((t) => t.dueOn && at(`${t.dueOn}T23:59:00+05:30`) < now.getTime()).length,
    doneThisWeek: todos.filter((t) => t.done && t.dueOn && at(`${t.dueOn}T00:00:00+05:30`) >= now.getTime() - 7 * DAY).length,
  };
}

// ---------------------------------------------------------------- agents
export function agentStats(view: TenantView): { running: number; total: number; tokens: number; cap: number; capPct: number; needsNudge: { name: string; status: string } | undefined; ranToday: number } {
  const { jobs, agentTokenCap } = view.data.workspace;
  const tokens = jobs.reduce((a, j) => a + j.tokensToday, 0);
  const bad = jobs.find((j) => j.status === "retrying" || j.status === "failed");
  return {
    running: jobs.filter((j) => j.status === "running").length,
    total: jobs.length,
    tokens,
    cap: agentTokenCap,
    capPct: agentTokenCap ? tokens / agentTokenCap : 0,
    needsNudge: bad ? { name: bad.name, status: bad.status } : undefined,
    ranToday: jobs.reduce((a, j) => a + j.runs.filter((r) => r.startedAt.slice(0, 10) === DEMO_NOW.toISOString().slice(0, 10) || at(r.startedAt) >= DEMO_NOW.getTime() - DAY).length, 0),
  };
}

// ---------------------------------------------------------------- activity
/** Firm-wide events: audit log, confirmed decisions, decided approvals and the workspace's own uploads/syncs. */
export function activityFeed(view: TenantView, days = 30, now = DEMO_NOW): ActivityItem[] {
  const since = now.getTime() - days * DAY;
  const items: ActivityItem[] = [...view.data.workspace.activity];
  for (const d of view.data.decisions) {
    if (d.status === "decided" && d.decidedAt) items.push({ id: `ac-dec-${d.decisionId}`, at: d.decidedAt, actor: d.decidedBy ?? d.reviewedBy ?? "A teammate", verb: "confirmed", target: d.title, projectId: d.projectId });
  }
  for (const a of view.approvals) {
    if (a.status !== "pending" && a.decidedAt) items.push({ id: `ac-apr-${a.approvalId}`, at: a.decidedAt, actor: a.decidedBy ?? "A partner", verb: a.status === "approved" ? "approved" : "rejected", target: a.title, projectId: a.projectId });
  }
  for (const e of view.audit) {
    if (e.action.startsWith("source.")) items.push({ id: `ac-${e.id}`, at: e.at, actor: e.actor, verb: "synced", target: `${e.action === "source.connect" ? "Connected" : "Updated"} ${e.target}` });
  }
  const seen = new Set<string>();
  return items
    .filter((i) => at(i.at) >= since && at(i.at) <= now.getTime() + 36e5 && !seen.has(i.id) && seen.add(i.id))
    .sort((a, b) => b.at.localeCompare(a.at));
}

// ---------------------------------------------------------------- apps
export interface AppRow extends AppDef {
  liveStatus: "connected" | "available" | "attention";
  sources: Source[];
}

/** An app is "connected" when a source of its type exists; "attention" when any of them needs re-authorising. */
export function appRows(view: TenantView): AppRow[] {
  return view.data.workspace.apps.map((a) => {
    const sources = a.connectorType ? view.sources.filter((s) => s.connectorType === a.connectorType) : [];
    const liveStatus: AppRow["liveStatus"] = !sources.length ? "available" : sources.some((s) => s.health === "auth_error" || s.health === "failing") ? "attention" : "connected";
    return { ...a, liveStatus, sources };
  });
}

// ---------------------------------------------------------------- history & explore
export function historyStats(view: TenantView, days = 30, now = DEMO_NOW): { thisPeriod: number; previous: number; helpfulPct: number | undefined; rated: number; weekly: number[] } {
  const h = view.data.workspace.history;
  const inWindow = (from: number, to: number) => h.filter((x) => at(x.at) >= from && at(x.at) < to);
  const t = now.getTime();
  const current = inWindow(t - days * DAY, t + DAY);
  const rated = current.filter((x) => x.helpful !== undefined);
  const weekly = Array.from({ length: 6 }, (_, i) => inWindow(t - (6 - i) * 7 * DAY, t - (5 - i) * 7 * DAY + (i === 5 ? DAY : 0)).length);
  return {
    thisPeriod: current.length,
    previous: inWindow(t - 2 * days * DAY, t - days * DAY).length,
    helpfulPct: rated.length ? rated.filter((x) => x.helpful).length / rated.length : undefined,
    rated: rated.length,
    weekly,
  };
}

export interface TopicCard {
  id: string;
  kind: "COST OVERRUN" | "REVISION BOTTLENECK" | "DISPUTE" | "PAYMENT DELAY" | "CHANGE ORDER" | "RFI" | "SITE DELAY" | "VENDOR QUOTE";
  headline: string;
  detail: string;
  tone: "lime" | "sky" | "pink" | "lavender" | "cream" | "green";
  ask: string;
  evidenceIds: string[];
  /** Finance topics are hidden from roles without finance.view. */
  finance: boolean;
}

/** Insight cards computed from the ledger, documents, mail and events. Nothing is written by hand. */
export function topicCards(view: TenantView, can: Can, now = DEMO_NOW): TopicCard[] {
  const ds = view.data;
  const cards: TopicCard[] = [];
  const name = (id: string) => ds.projects.find((p) => p.projectId === id)?.name ?? id;
  const fmt = (n: number) => new Intl.NumberFormat("en-IN").format(Math.round(n));

  for (const row of portfolio(ds, now).filter((r) => r.finance.overrun > 0).sort((a, b) => b.finance.overrunPct - a.finance.overrunPct).slice(0, 1)) {
    const worst = row.finance.lines.filter((l) => l.overrun > 0).sort((a, b) => b.overrun - a.overrun)[0];
    cards.push({ id: `cost-${row.project.projectId}`, kind: "COST OVERRUN", headline: `${row.project.name} is ${Math.round(row.finance.overrunPct * 100)}% over budget`, detail: `${worst ? `${worst.package} is the largest movement (₹${fmt(worst.overrun)} over).` : ""} Figures come from the ledger.`, tone: "lime", ask: `Why is ${row.project.name} over budget?`, evidenceIds: worst ? worst.txnIds.slice(0, 2).map((t) => `ev-${t}`) : [], finance: true });
  }

  const bySeries = new Map<string, number>();
  for (const d of ds.documents.filter((d) => d.docType === "drawing" && d.series)) bySeries.set(d.series!, (bySeries.get(d.series!) ?? 0) + 1);
  const [series, revisions] = [...bySeries].sort((a, b) => b[1] - a[1])[0] ?? [];
  if (series && revisions && revisions > 1) {
    const latest = ds.documents.find((d) => d.series === series && d.isLatest);
    cards.push({ id: `rev-${series}`, kind: "REVISION BOTTLENECK", headline: `${series} has ${revisions} revisions`, detail: latest ? `Now at Rev ${latest.revision}: ${latest.summary}` : "", tone: "sky", ask: `What is the latest revision of ${series}?`, evidenceIds: ds.documents.filter((d) => d.series === series).map((d) => d.evidenceId), finance: false });
  }

  const dup = leakageFlags(ds).find((f) => f.kind === "duplicate_invoice");
  if (dup) cards.push({ id: `dup-${dup.id}`, kind: "DISPUTE", headline: dup.title, detail: `${dup.detail} ₹${fmt(dup.amount)} would be paid twice.`, tone: "pink", ask: `Which vendor invoices look duplicated?`, evidenceIds: dup.evidenceIds, finance: true });

  const late = openReceivables(ds, now).filter((r) => r.daysOverdue > 0);
  const worstLate = late[0];
  if (worstLate) cards.push({ id: "late", kind: "PAYMENT DELAY", headline: `${late.length} client payment${late.length > 1 ? "s" : ""} overdue`, detail: `${worstLate.counterparty} is ${worstLate.daysOverdue} days late on ${worstLate.txnRef}.`, tone: "cream", ask: "Which client payments are overdue?", evidenceIds: late.map((r) => r.evidenceId), finance: true });

  const unsigned = leakageFlags(ds).find((f) => f.kind === "unsigned_variation");
  if (unsigned) cards.push({ id: `unsigned-${unsigned.id}`, kind: "CHANGE ORDER", headline: unsigned.title, detail: `${unsigned.detail}`, tone: "lavender", ask: `What is the status of the ${name(unsigned.projectId)} variation?`, evidenceIds: unsigned.evidenceIds, finance: true });

  const rfis = ds.workspace.mail.filter((t) => t.category === "RFI" && t.unread);
  const firstRfi = rfis[0];
  if (firstRfi) cards.push({ id: "rfi", kind: "RFI", headline: `${rfis.length} unread RFI${rfis.length > 1 ? "s" : ""}`, detail: `${firstRfi.subject} (${firstRfi.fromOrg}).`, tone: "green", ask: "Which RFIs are still open?", evidenceIds: rfis.map((t) => t.evidenceId).filter((x): x is string => Boolean(x)), finance: Boolean(firstRfi.financial) });

  const delay = ds.events.filter((e) => e.eventType === "site").sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
  if (delay) cards.push({ id: `site-${delay.eventId}`, kind: "SITE DELAY", headline: delay.title, detail: `${name(delay.projectId)} — ${delay.description ?? ""}`, tone: "sky", ask: `What changed on ${name(delay.projectId)} recently?`, evidenceIds: delay.evidenceId ? [delay.evidenceId] : [], finance: false });

  return cards.filter((c) => !c.finance || can("finance.view"));
}

/** Category counts for the wedge chart, each a count of rows, never an estimate. */
export function wedgeCounts(view: TenantView, can: Can, now = DEMO_NOW): { label: string; value: number }[] {
  const ds = view.data;
  const finance = can("finance.view");
  const over = finance ? portfolio(ds, now).reduce((a, r) => a + r.finance.lines.filter((l) => l.overrun > 0).length, 0) : 0;
  const bySeries = new Map<string, number>();
  for (const d of ds.documents.filter((d) => d.docType === "drawing" && d.series)) bySeries.set(d.series!, (bySeries.get(d.series!) ?? 0) + 1);
  const revisions = [...bySeries.values()].filter((n) => n > 1).reduce((a, n) => a + n - 1, 0);
  return [
    { label: "Cost overruns", value: over },
    { label: "Drawing revisions", value: revisions },
    { label: "Payment delays", value: finance ? openReceivables(ds, now).filter((r) => r.daysOverdue > 0).length : 0 },
    { label: "Contractor disputes", value: ds.workspace.bases.flatMap((b) => b.rows).filter((r) => r["status"] === "Dispute").length },
    { label: "RFIs open", value: ds.workspace.mail.filter((t) => t.category === "RFI" && t.unread && (!t.financial || finance)).length },
    { label: "Change orders", value: finance ? ds.txns.filter((t) => t.txnType === "change_order" && t.status !== "cancelled").length : 0 },
    { label: "Site delays", value: ds.events.filter((e) => e.eventType === "site").length },
    { label: "Vendor quotes", value: ds.documents.filter((d) => d.docType === "quotation").length },
  ];
}

// ---------------------------------------------------------------- shared
export function projectName(view: TenantView, id?: string): string {
  if (!id) return "Workspace";
  return view.data.projects.find((p) => p.projectId === id)?.name ?? id;
}

/** "Today" / "Yesterday" / "27 Sep" (IST) for a list column. */
export function shortWhen(iso: string, now = DEMO_NOW): string {
  const tz = "Asia/Kolkata";
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
  const d = new Date(iso);
  if (day(d) === day(now)) return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(d);
  if (day(d) === day(new Date(now.getTime() - DAY))) return "Yesterday";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: tz }).format(d);
}


// ---------------------------------------------------------------- presentation helpers
const PASTELS = ["sky", "pink", "green", "lavender", "cream", "lime"] as const;
export type Pastel = (typeof PASTELS)[number];

/** A stable pastel for a key (project id, person, space) so the same thing is always the same colour. */
export function toneFor(key: string): Pastel {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PASTELS[h % PASTELS.length]!;
}

export function initialsOf(name: string): string {
  return name
    .replace(/\(.*?\)/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** Keyword ranking over a thread's subject, sender, messages and extraction, used by the inbox search box. */
export function searchThreads(threads: MailThread[], query: string): MailThread[] {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  if (!terms.length) return threads;
  return threads
    .map((t) => {
      const hay = [t.subject, t.fromName, t.fromOrg, t.category, ...t.messages.map((m) => m.body), ...t.extraction.decisions.map((d) => d.text), ...t.extraction.commitments.map((c) => c.text)].join(" ").toLowerCase();
      const score = terms.reduce((a, w) => a + (hay.includes(w) ? 1 : 0) + (t.subject.toLowerCase().includes(w) ? 2 : 0), 0);
      return { t, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.t.lastAt.localeCompare(a.t.lastAt))
    .map((x) => x.t);
}

// ---------------------------------------------------------------- knowledge search
export interface KnowledgeHit {
  kind: "Document" | "Email" | "File" | "Base row" | "Graph node";
  label: string;
  sub?: string;
  href: string;
}

/** Quick search across everything the workspace has indexed that this role may see. */
export function knowledgeSearch(view: TenantView, can: Can, query: string, limit = 24): KnowledgeHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const has = (...xs: (string | number | undefined)[]) => xs.some((x) => String(x ?? "").toLowerCase().includes(q));
  const hits: KnowledgeHit[] = [];
  if (can("documents.view")) {
    for (const d of view.data.documents.filter((d) => has(d.title, d.series, d.summary, d.fileName, ...d.facts))) hits.push({ kind: "Document", label: d.series ? `${d.series} Rev ${d.revision} — ${d.title}` : d.title, sub: projectName(view, d.projectId), href: `/documents?q=${encodeURIComponent(d.series ?? d.title)}` });
  }
  if (can("comms.view")) {
    for (const t of visibleMail(view, can).filter((t) => has(t.subject, t.fromOrg, ...t.messages.map((m) => m.body)))) hits.push({ kind: "Email", label: t.subject, sub: t.fromOrg, href: `/communications/${t.threadId}` });
  }
  for (const f of view.data.workspace.files.filter((f) => has(f.name))) hits.push({ kind: "File", label: f.name, sub: f.meta, href: `/knowledge/files?folder=${f.folderId}` });
  for (const b of view.data.workspace.bases) {
    for (const r of b.rows.filter((r) => has(...Object.values(r)))) hits.push({ kind: "Base row", label: String(Object.values(r)[0]), sub: b.name, href: `/knowledge/bases?base=${b.baseId}&q=${encodeURIComponent(String(Object.values(r)[0]))}` });
  }
  for (const n of view.data.workspace.graph.nodes.filter((n) => has(n.label))) hits.push({ kind: "Graph node", label: n.label, sub: n.kind, href: `/knowledge/graph?node=${n.id}` });
  return hits.slice(0, limit);
}

// ---------------------------------------------------------------- agent run log
export interface LogLine {
  t: string;
  kind: "PLAN" | "TOOL" | "RESULT" | "ERROR" | "RETRY" | "LLM" | "DONE";
  text: string;
}

/** The terminal-style log of a run: what it planned, each tool call and its result, errors and retries. */
export function runLog(job: { name: string }, run: { status: string; attempt: number; steps: { at: string; tool: string; detail: string; tokens: number; error?: string }[] }): LogLine[] {
  const out: LogLine[] = [];
  const first = run.steps[0];
  if (first) out.push({ t: first.at, kind: "PLAN", text: job.name });
  for (const s of run.steps) {
    out.push({ t: s.at, kind: s.tool.startsWith("llm.") ? "LLM" : "TOOL", text: s.tool });
    if (s.error) {
      out.push({ t: s.at, kind: "ERROR", text: s.error });
      out.push({ t: s.at, kind: "RETRY", text: `attempt ${Math.min(run.attempt + 1, 5)} of 5` });
    } else {
      out.push({ t: s.at, kind: "RESULT", text: s.detail });
    }
  }
  const last = run.steps[run.steps.length - 1];
  if (last) out.push({ t: last.at, kind: "DONE", text: run.status === "running" ? "still running" : run.status === "ok" ? "run finished" : `run ${run.status}` });
  return out;
}

export function runStats(run: { attempt: number; steps: { tokens: number; error?: string }[] }, durationSec: number): { tokens: number; duration: string; retries: number; errors: number } {
  return {
    tokens: run.steps.reduce((a, s) => a + s.tokens, 0),
    duration: `${String(Math.floor(durationSec / 60)).padStart(2, "0")}:${String(durationSec % 60).padStart(2, "0")}`,
    retries: Math.max(0, run.attempt - 1),
    errors: run.steps.filter((s) => s.error).length,
  };
}
