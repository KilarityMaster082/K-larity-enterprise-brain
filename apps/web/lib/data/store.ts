// Owner task: EB-23 Web UI shell — DEVELOPMENT store: per-tenant, in-memory copy of the demo data plus the
// mutations the UI performs (decision review, approvals, members, sources, onboarding), each with an audit
// event. Replaced by apps/api calls once the backend exists; the function names are the future API.
// State lives on globalThis so it survives hot reload; it resets when the dev server restarts.
import type { Evidence } from "../contracts";
import { EMPTY_WORKSPACE } from "./empty";
import { SYNTHETIC_DATA } from "./seed-synthetic";
import { STUDIO8_DATA } from "./seed-studio8";
import type { Approval, AuditEvent, Decision, HistoryItem, Member, Role, Source, TenantDataset } from "./types";

/** Simulated duration of a first sync after connecting a source. */
export const SYNC_MS = 12_000;

interface TenantState {
  data: TenantDataset;
  /** Tenant data stays hidden until at least one source has finished its first sync (onboarding demo). */
  gatedUntilSynced: boolean;
  onboarding: { askedFirstQuestion: boolean };
  seq: number;
}

const EMPTY: TenantDataset = {
  people: [], projects: [], budgetLines: [], txns: [], events: [], documents: [], decisions: [],
  approvals: [], sources: [], members: [], audit: [], evidence: [], workspace: EMPTY_WORKSPACE,
};

const g = globalThis as unknown as { __klarityStore?: Map<string, TenantState> };
const store = (g.__klarityStore ??= new Map());

function seedFor(slug: string): { data: TenantDataset; gated: boolean } {
  if (slug === "studio8") return { data: STUDIO8_DATA, gated: false };
  if (slug === "synthetic-canary") return { data: SYNTHETIC_DATA, gated: true };
  return { data: EMPTY, gated: true };
}

function state(tenantId: string, slug: string): TenantState {
  let s = store.get(tenantId);
  if (!s) {
    const seed = seedFor(slug);
    s = { data: structuredClone(seed.data), gatedUntilSynced: seed.gated, onboarding: { askedFirstQuestion: !seed.gated }, seq: 1 };
    store.set(tenantId, s);
  }
  return s;
}

function settleSyncs(s: TenantState, now: number): void {
  for (const src of s.data.sources) {
    if (src.health === "syncing" && now - new Date(src.syncStartedAt ?? src.connectedAt).getTime() >= SYNC_MS) {
      src.syncStartedAt = undefined;
      src.health = "ok";
      src.lastSyncAt = new Date(now).toISOString();
      src.itemsSeen = src.itemsSeen || 1;
      src.lagMinutes = 0;
    }
  }
}

export interface TenantView {
  data: TenantDataset;
  sources: Source[];
  members: Member[];
  audit: AuditEvent[];
  approvals: Approval[];
  hasSyncedSource: boolean;
  onboarding: { connected: boolean; synced: boolean; askedFirstQuestion: boolean; done: boolean };
  syncProgress?: number; // 0–1 while a first sync runs
}

/** Everything a page may show for this tenant. Pages must not reach into the store any other way. */
export function tenantView(tenantId: string, slug: string, now = Date.now()): TenantView {
  const s = state(tenantId, slug);
  settleSyncs(s, now);
  const synced = s.data.sources.some((x) => x.health !== "syncing" && x.health !== "never_run");
  const syncing = s.data.sources.find((x) => x.health === "syncing");
  const hidden = s.gatedUntilSynced && !synced;
  const data: TenantDataset = hidden
    ? { ...EMPTY, sources: s.data.sources, members: s.data.members, audit: s.data.audit, approvals: s.data.approvals }
    : s.data;
  const connected = s.data.sources.length > 0;
  return {
    data,
    sources: s.data.sources,
    members: s.data.members,
    audit: [...s.data.audit].sort((a, b) => b.at.localeCompare(a.at)),
    approvals: s.data.approvals,
    hasSyncedSource: synced,
    onboarding: {
      connected,
      synced,
      askedFirstQuestion: s.onboarding.askedFirstQuestion,
      done: connected && synced && s.onboarding.askedFirstQuestion,
    },
    syncProgress: syncing ? Math.min(0.99, (now - new Date(syncing.syncStartedAt ?? syncing.connectedAt).getTime()) / SYNC_MS) : undefined,
  };
}

export function evidenceById(view: TenantView, ids: string[]): Evidence[] {
  const byId = new Map(view.data.evidence.map((e) => [e.id, e]));
  return ids.map((id) => byId.get(id)).filter((e): e is Evidence => Boolean(e));
}

// ---------------------------------------------------------------- mutations
export class StoreError extends Error {}

function audit(s: TenantState, actor: string, action: string, target: string, detail?: string): void {
  s.data.audit.push({ id: `au-${Date.now()}-${s.seq++}`, at: new Date().toISOString(), actor, action, target, detail });
}

export function reviewDecision(
  tenantId: string,
  slug: string,
  actor: string,
  decisionId: string,
  action: "confirm" | "reject" | "edit",
  input: { title?: string; description?: string; note?: string } = {},
): Decision {
  const s = state(tenantId, slug);
  const d = s.data.decisions.find((x) => x.decisionId === decisionId);
  if (!d) throw new StoreError("decision not found");
  if (d.status !== "proposed") throw new StoreError("only draft decisions can be reviewed");
  if (action === "reject") {
    d.status = "revoked";
    d.reviewNote = input.note?.trim() || undefined;
  } else {
    if (action === "edit") {
      const title = input.title?.trim();
      const description = input.description?.trim();
      if (!title || !description) throw new StoreError("title and description are required");
      d.title = title.slice(0, 200);
      d.description = description.slice(0, 2000);
    }
    d.status = "decided";
    d.decidedAt = d.decidedAt ?? new Date().toISOString();
    d.reviewNote = input.note?.trim() || undefined;
  }
  d.reviewedBy = actor;
  audit(s, actor, `decision.${action === "reject" ? "reject" : action === "edit" ? "edit_confirm" : "confirm"}`, d.title, input.note);
  return d;
}

export function createApproval(
  tenantId: string,
  slug: string,
  actor: string,
  input: Pick<Approval, "kind" | "title" | "body" | "reason" | "evidenceIds"> & { projectId?: string },
): Approval {
  const s = state(tenantId, slug);
  const dup = s.data.approvals.find((a) => a.status === "pending" && a.title === input.title);
  if (dup) return dup;
  const a: Approval = {
    approvalId: `apr-${Date.now().toString(36)}-${s.seq++}`,
    requestedBy: actor,
    requestedVia: "ask_brain",
    requestedAt: new Date().toISOString(),
    status: "pending",
    ...input,
    title: input.title.slice(0, 200),
    body: input.body.slice(0, 4000),
  };
  s.data.approvals.push(a);
  audit(s, actor, "approval.request", a.title);
  return a;
}

export function decideApproval(
  tenantId: string,
  slug: string,
  actor: string,
  approvalId: string,
  decision: "approve" | "reject",
  note: string,
  editedBody?: string,
): Approval {
  const s = state(tenantId, slug);
  const a = s.data.approvals.find((x) => x.approvalId === approvalId);
  if (!a) throw new StoreError("approval not found");
  if (a.status !== "pending") throw new StoreError("already decided");
  if (decision === "reject" && !note.trim()) throw new StoreError("a reason is required to reject");
  if (editedBody !== undefined && editedBody.trim() && editedBody !== a.body) {
    a.body = editedBody.slice(0, 4000);
    audit(s, actor, "approval.edit", a.title);
  }
  a.status = decision === "approve" ? "approved" : "rejected";
  a.decidedBy = actor;
  a.decidedAt = new Date().toISOString();
  a.note = note.trim() || undefined;
  audit(s, actor, `approval.${decision}`, a.title, a.note);
  return a;
}

export function setMemberRole(tenantId: string, slug: string, actor: string, userId: string, role: Role): Member {
  const s = state(tenantId, slug);
  const m = s.data.members.find((x) => x.userId === userId);
  if (!m) throw new StoreError("member not found");
  const owners = s.data.members.filter((x) => x.role === "owner" && x.status !== "disabled");
  if (m.role === "owner" && role !== "owner" && owners.length <= 1) throw new StoreError("a workspace needs at least one owner");
  const before = m.role;
  m.role = role;
  audit(s, actor, "member.role_change", m.email, `${before} → ${role}`);
  return m;
}

export function inviteMember(tenantId: string, slug: string, actor: string, email: string, role: Role): Member {
  const s = state(tenantId, slug);
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new StoreError("enter a valid email address");
  if (s.data.members.some((m) => m.email === clean)) throw new StoreError("already a member");
  const m: Member = { userId: `u-${Date.now().toString(36)}`, name: clean.split("@")[0]!, email: clean, role, status: "invited" };
  s.data.members.push(m);
  audit(s, actor, "member.invite", clean, role);
  return m;
}

const CONNECTOR_NAMES: Record<Source["connectorType"], string> = {
  gmail: "Gmail",
  drive: "Google Drive",
  sheets: "Google Sheets",
  whatsapp: "WhatsApp export",
  file_drop: "File drop folder",
  calendar: "Google Calendar",
};

export function connectSource(tenantId: string, slug: string, actor: string, type: Source["connectorType"], account: string): Source {
  const s = state(tenantId, slug);
  const acct = account.trim();
  if (!acct) throw new StoreError("account is required");
  const src: Source = {
    sourceId: `src-${Date.now().toString(36)}-${s.seq++}`,
    connectorType: type,
    displayName: CONNECTOR_NAMES[type],
    account: acct.slice(0, 120),
    health: "syncing",
    itemsSeen: 0,
    errorRate: 0,
    connectedAt: new Date().toISOString(),
  };
  s.data.sources.push(src);
  audit(s, actor, "source.connect", `${src.displayName} (${src.account})`);
  return src;
}

export function disconnectSource(tenantId: string, slug: string, actor: string, sourceId: string): void {
  const s = state(tenantId, slug);
  const src = s.data.sources.find((x) => x.sourceId === sourceId);
  if (!src) throw new StoreError("source not found");
  s.data.sources = s.data.sources.filter((x) => x.sourceId !== sourceId);
  audit(s, actor, "source.disconnect", `${src.displayName} (${src.account})`);
}

export function reconnectSource(tenantId: string, slug: string, actor: string, sourceId: string): Source {
  const s = state(tenantId, slug);
  const src = s.data.sources.find((x) => x.sourceId === sourceId);
  if (!src) throw new StoreError("source not found");
  src.health = "ok";
  src.lastError = undefined;
  src.errorRate = 0;
  src.lastSyncAt = new Date().toISOString();
  audit(s, actor, "source.reauthorise", `${src.displayName} (${src.account})`);
  return src;
}

/** Session History (screen 40): every question a person asks is kept with its topic, newest first. */
export function recordQuestion(tenantId: string, slug: string, userId: string, question: string, topic: string, projectId?: string): HistoryItem {
  const s = state(tenantId, slug);
  const item: HistoryItem = { historyId: `h-${Date.now().toString(36)}-${s.seq++}`, at: new Date().toISOString(), question: question.slice(0, 2000), topic, projectId, userId };
  s.data.workspace.history.unshift(item);
  return item;
}

export function rateHistory(tenantId: string, slug: string, userId: string, historyId: string, helpful: boolean): void {
  const s = state(tenantId, slug);
  const h = s.data.workspace.history.find((x) => x.historyId === historyId && x.userId === userId);
  if (!h) throw new StoreError("question not found");
  h.helpful = helpful;
}

/** "Test connection": a read-only probe. Healthy sources pass; one that needs re-authorising says so. */
export function testSource(tenantId: string, slug: string, actor: string, sourceId: string): { ok: boolean; message: string } {
  const s = state(tenantId, slug);
  const src = s.data.sources.find((x) => x.sourceId === sourceId);
  if (!src) throw new StoreError("source not found");
  audit(s, actor, "source.test", `${src.displayName} (${src.account})`);
  if (src.health === "auth_error") return { ok: false, message: `${src.displayName}: ${src.lastError ?? "sign-in expired"}. Reconnect it to resume syncing.` };
  if (src.health === "failing") return { ok: false, message: `${src.displayName} is failing: ${src.lastError ?? "see the sync log"}.` };
  if (src.health === "syncing" || src.health === "never_run") return { ok: true, message: `${src.displayName} is reachable. The first sync has not finished yet.` };
  return { ok: true, message: `${src.displayName} is reachable${src.lagMinutes !== undefined ? `; last item ${src.lagMinutes} min ago` : ""}.` };
}

/** "Sync now": starts a sync of a healthy source. Sources that need re-authorising must be reconnected first. */
export function triggerSync(tenantId: string, slug: string, actor: string, sourceId: string): Source {
  const s = state(tenantId, slug);
  const src = s.data.sources.find((x) => x.sourceId === sourceId);
  if (!src) throw new StoreError("source not found");
  if (src.health === "auth_error") throw new StoreError("reconnect this source first: its sign-in has expired");
  if (src.health === "syncing") throw new StoreError("a sync is already running");
  src.health = "syncing";
  src.syncStartedAt = new Date().toISOString();
  audit(s, actor, "source.sync", `${src.displayName} (${src.account})`);
  return src;
}

export const RETENTION_CHOICES = [90, 365, 1095, 1825, 2555] as const;

export function setRetention(tenantId: string, slug: string, actor: string, days: number): number {
  const s = state(tenantId, slug);
  if (!(RETENTION_CHOICES as readonly number[]).includes(days)) throw new StoreError("choose a retention period from 90 days to 7 years");
  const before = s.data.workspace.retention.days;
  s.data.workspace.retention.days = days;
  audit(s, actor, "retention.update", "Tenant retention policy", `${before} → ${days} days`);
  return days;
}

export function recordAuditExport(tenantId: string, slug: string, actor: string, rows: number): void {
  const s = state(tenantId, slug);
  s.data.workspace.retention.auditExportAt = new Date().toISOString();
  audit(s, actor, "audit.export", "Audit log", `${rows} events`);
}

export function markAskedFirstQuestion(tenantId: string, slug: string): void {
  state(tenantId, slug).onboarding.askedFirstQuestion = true;
}

/** Test helper: forget all in-memory state. */
export function resetStore(): void {
  store.clear();
}
