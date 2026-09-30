// Owner task: EB-88 Tenant admin console — operator-console data beyond the tenant registry: the ingestion dead-letter queue
// (screen 50), connector lag (49), LLM gateway spend (52) and cell infrastructure health (54). DEVELOPMENT data that mirrors
// the real shapes: db/migrations/0004_ingestion_dead_letter.sql, services/llm-gateway/config.yaml (USD 500 monthly cap,
// 85 % alert, aliases fast / reason / embed / rerank) and services/context-engine/rerank.py (p95 < 400 ms).
// Every row carries its tenant; every change is audited. Replaced by apps/api once it exposes these (tracked in the decision log).
import { AdminError, audit, getTenant, listTenants, type AdminTenant, type SourceHealthRow } from "./data";

// ---------------------------------------------------------------- dead-letter queue
export const DLQ_STAGES = ["sync", "parse", "chunk", "embed", "index", "extract_events", "resolve_entities"] as const;
export type DlqStage = (typeof DLQ_STAGES)[number];

export interface DeadLetter {
  id: string;
  tenantId: string;
  sourceId: string;
  itemRef: string;
  stage: DlqStage;
  errorType: string;
  errorMessage: string;
  /** Activity failure trace from Temporal, as recorded with the item. */
  stack: string;
  attemptCount: number;
  idempotencyKey: string;
  payloadRef?: string;
  failedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionNotes?: string;
}

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const S8 = "0fdc5142-8c25-41c5-aab4-0a88db52a5bf";

function dl(n: number, row: Omit<DeadLetter, "id" | "idempotencyKey" | "tenantId">): DeadLetter {
  return { ...row, id: `dl-${String(n).padStart(4, "0")}`, tenantId: S8, idempotencyKey: `${S8}:${row.sourceId}:${row.itemRef}:${row.stage}` };
}

function seedDeadLetters(): DeadLetter[] {
  const gmail = (n: number, historyId: number): DeadLetter =>
    dl(n, {
      sourceId: "src-gmail-accounts",
      itemRef: `history:${historyId}`,
      stage: "sync",
      errorType: "InvalidGrantError",
      errorMessage: "invalid_grant: token has been expired or revoked",
      stack: "InvalidGrantError: invalid_grant\n  at refresh_access_token (connectors/gmail/auth.py:88)\n  at list_history (connectors/gmail/client.py:41)\n  at sync_activity (workflows/pipeline.py:132)",
      attemptCount: 5,
      failedAt: ago(2 * 24 * 60 + 170 - n),
    });
  return [
    ...Array.from({ length: 14 }, (_, i) => gmail(i + 1, 8_371_044 + i * 2_000)),
    dl(15, { sourceId: "src-whatsapp", itemRef: "export:phoenix-client-group-2026-09-28.zip", stage: "parse", errorType: "WhatsAppExportParseError", errorMessage: "line 4,118: unrecognised timestamp '28/09/26, 9.41 pm'", stack: "WhatsAppExportParseError: unrecognised timestamp\n  at parse_line (connectors/whatsapp_export/parser.py:97)\n  at parse_export (connectors/whatsapp_export/parser.py:140)", attemptCount: 3, failedAt: ago(250), payloadRef: "s3://tenants/0fdc5142/exports/phoenix-2026-09-28.zip" }),
    dl(16, { sourceId: "src-whatsapp", itemRef: "export:phoenix-client-group-2026-09-27.zip", stage: "parse", errorType: "WhatsAppExportParseError", errorMessage: "line 982: media reference without a file", stack: "WhatsAppExportParseError: media reference without a file\n  at attach_media (connectors/whatsapp_export/parser.py:171)", attemptCount: 3, failedAt: ago(1_700), payloadRef: "s3://tenants/0fdc5142/exports/phoenix-2026-09-27.zip" }),
    dl(17, { sourceId: "src-drive", itemRef: "drive:1Xk…/PHX-STR-204-RevC-scan.pdf", stage: "parse", errorType: "DoclingTimeoutError", errorMessage: "Docling TableFormer exceeded 120 s on page 7 (scanned drawing, 600 dpi)", stack: "DoclingTimeoutError: page 7 exceeded 120 s\n  at convert (normalization/docling_adapter.py:64)\n  at parse_activity (workflows/pipeline.py:188)", attemptCount: 4, failedAt: ago(95), payloadRef: "s3://tenants/0fdc5142/drive/PHX-STR-204-RevC-scan.pdf" }),
    dl(18, { sourceId: "src-drive", itemRef: "drive:1Yq…/Site-photos-week-38.zip", stage: "parse", errorType: "UnsupportedFormatError", errorMessage: "archive contains only images without text; OCR disabled for this folder", stack: "UnsupportedFormatError: no extractable text\n  at route_parser (normalization/router.py:52)", attemptCount: 1, failedAt: ago(610), payloadRef: "s3://tenants/0fdc5142/drive/Site-photos-week-38.zip" }),
    dl(19, { sourceId: "src-drive", itemRef: "drive:1Zt…/Facade-quote-rev3.pdf", stage: "chunk", errorType: "TableStructureError", errorMessage: "TableFormer returned overlapping cells on page 2", stack: "TableStructureError: overlapping cells\n  at chunk_tables (normalization/chunking.py:203)", attemptCount: 2, failedAt: ago(1_280), payloadRef: "s3://tenants/0fdc5142/drive/Facade-quote-rev3.pdf" }),
  ];
}

interface OpsState {
  dlq: DeadLetter[];
  gatewayBudget: Record<string, number>;
}
const g = globalThis as unknown as { __klarityOps?: OpsState };
const ops: OpsState = (g.__klarityOps ??= { dlq: seedDeadLetters(), gatewayBudget: {} });

export function resetOpsData(): void {
  ops.dlq = seedDeadLetters();
  ops.gatewayBudget = {};
}

export interface DlqFilter {
  tenantId?: string;
  stage?: string;
  sourceId?: string;
  state?: "open" | "resolved" | "all";
}

export function listDeadLetters(f: DlqFilter = {}): DeadLetter[] {
  const tenants = new Set(listTenants().map((t) => t.tenantId));
  return ops.dlq
    .filter((d) => tenants.has(d.tenantId)) // a row whose tenant is gone is never shown
    .filter((d) => (f.tenantId ? d.tenantId === f.tenantId : true))
    .filter((d) => (f.stage ? d.stage === f.stage : true))
    .filter((d) => (f.sourceId ? d.sourceId === f.sourceId : true))
    .filter((d) => ((f.state ?? "open") === "all" ? true : (f.state ?? "open") === "open" ? !d.resolvedAt : Boolean(d.resolvedAt)))
    .sort((a, b) => b.failedAt.localeCompare(a.failedAt));
}

export function openDeadLetters(tenantId: string, sourceId?: string): number {
  return ops.dlq.filter((d) => d.tenantId === tenantId && !d.resolvedAt && (sourceId ? d.sourceId === sourceId : true)).length;
}

export function getDeadLetter(id: string): DeadLetter | undefined {
  return ops.dlq.find((d) => d.id === id);
}

export function dlqByStage(rows: DeadLetter[]): { stage: DlqStage; count: number }[] {
  return DLQ_STAGES.map((stage) => ({ stage, count: rows.filter((r) => r.stage === stage).length })).filter((x) => x.count > 0);
}

/** Replay = run the same item again under the same idempotency key, so a replay can never double-ingest. */
export function replayDeadLetter(operator: string, id: string, reason: string): DeadLetter {
  const d = getDeadLetter(id);
  if (!d) throw new AdminError("dead-letter item not found");
  if (d.resolvedAt) throw new AdminError("this item is already resolved");
  if (reason.trim().length < 10) throw new AdminError("give a reason of at least 10 characters");
  const t = getTenant(d.tenantId);
  if (!t) throw new AdminError("tenant not found");
  if (t.status !== "active") throw new AdminError("only active tenants can have items replayed");
  const src = t.sources.find((s) => s.sourceId === d.sourceId);
  if (src?.health === "auth_error") throw new AdminError("the source needs to be re-authorised by the tenant before items can be replayed");
  d.resolvedAt = new Date().toISOString();
  d.resolvedBy = operator;
  d.resolutionNotes = `Replayed: ${reason.trim()}`;
  audit(operator, "dlq.replay", t.slug, reason.trim(), `${d.itemRef} (${d.stage}) key ${d.idempotencyKey.slice(-40)}`);
  return d;
}

export function dismissDeadLetter(operator: string, id: string, reason: string): DeadLetter {
  const d = getDeadLetter(id);
  if (!d) throw new AdminError("dead-letter item not found");
  if (d.resolvedAt) throw new AdminError("this item is already resolved");
  if (reason.trim().length < 10) throw new AdminError("give a reason of at least 10 characters");
  const t = getTenant(d.tenantId);
  if (!t) throw new AdminError("tenant not found");
  d.resolvedAt = new Date().toISOString();
  d.resolvedBy = operator;
  d.resolutionNotes = `Dismissed: ${reason.trim()}`;
  audit(operator, "dlq.dismiss", t.slug, reason.trim(), `${d.itemRef} (${d.stage})`);
  return d;
}

// ---------------------------------------------------------------- connector lag (screen 49)
export interface PipelineRow extends SourceHealthRow {
  tenantId: string;
  tenantName: string;
  /** Connector SLA from the foundation plan: chat 5 minutes, files hourly. */
  slaMinutes: number;
  slaMet: boolean;
  historyLag?: number;
  openDeadLetters: number;
}

const SLA: Record<SourceHealthRow["type"], number> = { gmail: 5, whatsapp: 5, drive: 60, sheets: 60, file_drop: 60 };

export function pipelineRows(): PipelineRow[] {
  return listTenants().flatMap((t: AdminTenant) =>
    t.sources.map((s) => ({
      ...s,
      tenantId: t.tenantId,
      tenantName: t.name,
      slaMinutes: SLA[s.type],
      slaMet: s.lagMinutes <= SLA[s.type] * 2 && s.health !== "auth_error" && s.health !== "failing",
      historyLag: s.gmail ? Math.max(0, s.gmail.headHistoryId - s.gmail.processedHistoryId) : undefined,
      deadLetters: openDeadLetters(t.tenantId, s.sourceId), // live from the queue, so a replay shows here at once
      openDeadLetters: openDeadLetters(t.tenantId, s.sourceId),
    })),
  );
}

/** Docling (parser) health, from the same dead-letter rows the DLQ screen shows. */
export function doclingStats(): { open: number; byStage: { stage: DlqStage; count: number }[]; timeouts: number } {
  const rows = ops.dlq.filter((d) => !d.resolvedAt && (d.errorType.startsWith("Docling") || d.errorType === "TableStructureError"));
  return { open: rows.length, byStage: dlqByStage(rows), timeouts: rows.filter((r) => r.errorType === "DoclingTimeoutError").length };
}

// ---------------------------------------------------------------- LLM gateway (screen 52)
export const ALIASES = ["fast", "reason", "embed", "rerank"] as const;
export type Alias = (typeof ALIASES)[number];
export const DEFAULT_BUDGET_USD = 500;
export const ALERT_THRESHOLD = 0.85;

export interface AliasUse {
  alias: Alias;
  calls: number;
  costUsd: number;
  p50Ms: number;
  p95Ms: number;
  fallbackCalls: number;
}
export interface Trace {
  traceId: string;
  at: string;
  alias: Alias;
  costUsd: number;
  latencyMs: number;
  fellBackTo?: string;
  purpose: string;
}
interface GatewayUsage {
  spendUsd: number;
  byAlias: AliasUse[];
  traces: Trace[];
}

const USAGE: Record<string, GatewayUsage> = {
  studio8: {
    spendUsd: 183.4,
    byAlias: [
      { alias: "fast", calls: 5_120, costUsd: 14.2, p50Ms: 420, p95Ms: 910, fallbackCalls: 37 },
      { alias: "reason", calls: 1_004, costUsd: 121.9, p50Ms: 3_800, p95Ms: 9_400, fallbackCalls: 12 },
      { alias: "embed", calls: 38_400, costUsd: 39.8, p50Ms: 190, p95Ms: 380, fallbackCalls: 0 },
      { alias: "rerank", calls: 2_480, costUsd: 7.5, p50Ms: 140, p95Ms: 310, fallbackCalls: 4 },
    ],
    traces: [
      { traceId: "tr_7c1f0a", at: ago(6), alias: "reason", costUsd: 0.14, latencyMs: 4_120, purpose: "Answer synthesis" },
      { traceId: "tr_7c1f09", at: ago(6), alias: "rerank", costUsd: 0.003, latencyMs: 152, purpose: "Cross-encoder rerank (24 candidates)" },
      { traceId: "tr_7c1e88", at: ago(31), alias: "fast", costUsd: 0.0009, latencyMs: 388, fellBackTo: "fast-fallback", purpose: "Query understanding" },
      { traceId: "tr_7c1e52", at: ago(58), alias: "embed", costUsd: 0.0011, latencyMs: 176, purpose: "Chunk embeddings (Drive sync)" },
    ],
  },
  "synthetic-canary": {
    spendUsd: 12.8,
    byAlias: [
      { alias: "fast", calls: 1_300, costUsd: 1.1, p50Ms: 400, p95Ms: 880, fallbackCalls: 0 },
      { alias: "reason", calls: 140, costUsd: 9.6, p50Ms: 3_600, p95Ms: 8_800, fallbackCalls: 0 },
      { alias: "embed", calls: 400, costUsd: 1.0, p50Ms: 180, p95Ms: 350, fallbackCalls: 0 },
      { alias: "rerank", calls: 290, costUsd: 1.1, p50Ms: 130, p95Ms: 300, fallbackCalls: 0 },
    ],
    traces: [{ traceId: "tr_c4a001", at: ago(14), alias: "reason", costUsd: 0.09, latencyMs: 3_950, purpose: "Canary probe" }],
  },
};

export type BudgetState = "ok" | "alert" | "blocked";
export function budgetState(spendUsd: number, capUsd: number, threshold = ALERT_THRESHOLD): BudgetState {
  if (capUsd <= 0 || spendUsd >= capUsd) return "blocked"; // the gateway refuses calls at the cap (LlmRouter.BudgetExceededError)
  return spendUsd >= capUsd * threshold ? "alert" : "ok";
}

export interface GatewayRow {
  tenantId: string;
  tenantName: string;
  slug: string;
  capUsd: number;
  spendUsd: number;
  pct: number;
  state: BudgetState;
  byAlias: AliasUse[];
  traces: Trace[];
  isSynthetic: boolean;
}

export function gatewayRows(): GatewayRow[] {
  return listTenants()
    .filter((t) => t.status !== "provisioning")
    .map((t) => {
      const u = USAGE[t.slug] ?? { spendUsd: 0, byAlias: ALIASES.map((alias) => ({ alias, calls: 0, costUsd: 0, p50Ms: 0, p95Ms: 0, fallbackCalls: 0 })), traces: [] };
      const cap = ops.gatewayBudget[t.tenantId] ?? DEFAULT_BUDGET_USD;
      return { tenantId: t.tenantId, tenantName: t.name, slug: t.slug, capUsd: cap, spendUsd: u.spendUsd, pct: cap ? u.spendUsd / cap : 1, state: budgetState(u.spendUsd, cap), byAlias: u.byAlias, traces: u.traces, isSynthetic: t.isSynthetic };
    });
}

export function setGatewayBudget(operator: string, tenantId: string, capUsd: number, reason: string): void {
  const t = getTenant(tenantId);
  if (!t) throw new AdminError("tenant not found");
  if (!Number.isFinite(capUsd) || capUsd < 50 || capUsd > 5_000) throw new AdminError("the monthly cap must be between $50 and $5,000");
  if (reason.trim().length < 10) throw new AdminError("give a reason of at least 10 characters");
  const before = ops.gatewayBudget[tenantId] ?? DEFAULT_BUDGET_USD;
  ops.gatewayBudget[tenantId] = Math.round(capUsd);
  audit(operator, "gateway.set_budget", t.slug, reason.trim(), `$${before} → $${Math.round(capUsd)}`);
}

/** Link to a Langfuse trace, only when the deployment names its Langfuse host (LANGFUSE_BASE_URL, not a secret). */
export function traceUrl(traceId: string, base = process.env.LANGFUSE_BASE_URL): string | undefined {
  if (!base || !/^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~/-]*)?$/.test(base)) return undefined;
  return `${base.replace(/\/$/, "")}/trace/${encodeURIComponent(traceId)}`;
}

// ---------------------------------------------------------------- infrastructure (screen 54)
export type Health = "ok" | "degraded" | "failing";
export interface PgPool { name: string; active: number; idle: number; max: number; waiting: number; p95Ms: number }
export interface QdrantNode { id: string; up: boolean; shards: number; vectors: number; diskPct: number }
export interface OsCluster { status: "green" | "yellow" | "red"; nodes: number; unassignedShards: number; heapPct: number }
export interface TemporalQueue { name: string; workers: number; backlog: number; scheduleToStartP95Ms: number }
export interface Cell {
  cellId: string;
  region: string;
  pools: PgPool[];
  replicaLagMs: number;
  qdrant: QdrantNode[];
  opensearch: OsCluster;
  temporal: TemporalQueue[];
}

export function infrastructure(): Cell[] {
  return [
    {
      cellId: "pool-in-1",
      region: "ap-south-2",
      replicaLagMs: 38,
      pools: [
        { name: "brain (app, RLS)", active: 14, idle: 18, max: 50, waiting: 0, p95Ms: 11 },
        { name: "brain (workers)", active: 22, idle: 6, max: 30, waiting: 3, p95Ms: 19 },
        { name: "control-plane", active: 2, idle: 4, max: 10, waiting: 0, p95Ms: 6 },
      ],
      qdrant: [
        { id: "qdrant-0", up: true, shards: 12, vectors: 212_040, diskPct: 0.41 },
        { id: "qdrant-1", up: true, shards: 12, vectors: 211_988, diskPct: 0.4 },
        { id: "qdrant-2", up: true, shards: 12, vectors: 212_101, diskPct: 0.42 },
      ],
      opensearch: { status: "yellow", nodes: 3, unassignedShards: 2, heapPct: 0.63 },
      temporal: [
        { name: "pool.ingest", workers: 4, backlog: 12, scheduleToStartP95Ms: 240 },
        { name: "pool.normalize", workers: 3, backlog: 2, scheduleToStartP95Ms: 120 },
        { name: "pool.index", workers: 2, backlog: 0, scheduleToStartP95Ms: 90 },
      ],
    },
  ];
}

export function poolHealth(p: PgPool): Health {
  const load = p.max ? p.active / p.max : 1;
  if (load >= 1 || p.waiting > p.max * 0.2) return "failing";
  return load >= 0.85 || (p.waiting > 0 && load >= 0.7) ? "degraded" : "ok";
}
export function queueHealth(q: TemporalQueue): Health {
  if (q.workers === 0) return q.backlog > 0 ? "failing" : "degraded";
  return q.scheduleToStartP95Ms > 5_000 || q.backlog > q.workers * 500 ? "failing" : q.scheduleToStartP95Ms > 1_000 || q.backlog > q.workers * 100 ? "degraded" : "ok";
}
export function qdrantHealth(nodes: QdrantNode[]): Health {
  const down = nodes.filter((n) => !n.up).length;
  return down === 0 ? (nodes.some((n) => n.diskPct > 0.85) ? "degraded" : "ok") : down >= Math.ceil(nodes.length / 2) ? "failing" : "degraded";
}
export function opensearchHealth(c: OsCluster): Health {
  return c.status === "red" ? "failing" : c.status === "yellow" || c.heapPct > 0.85 ? "degraded" : "ok";
}
const ORDER: Record<Health, number> = { ok: 0, degraded: 1, failing: 2 };
export function worst(...hs: Health[]): Health {
  return hs.reduce<Health>((a, b) => (ORDER[b] > ORDER[a] ? b : a), "ok");
}
export function cellHealth(c: Cell): Health {
  return worst(...c.pools.map(poolHealth), qdrantHealth(c.qdrant), opensearchHealth(c.opensearch), ...c.temporal.map(queueHealth));
}
