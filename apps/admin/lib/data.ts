// Owner task: EB-88 Tenant admin console — DEVELOPMENT operator data. Mirrors the control-plane registry seed
// (services/control-plane/control_plane/seed.py) and its placement rules (placement.py) until apps/api exposes
// the registry, ProvisionTenant (EB-86) and metering (EB-87). In-memory; resets when the dev server restarts.

export type Tier = "pool" | "bridge" | "silo";
export type TenantStatus = "provisioning" | "active" | "suspended" | "offboarding" | "offboarded";
import { PLANS, type Plan } from "./plans";

export { PLANS, type Plan };

export interface Placement {
  cellId: string;
  region: string;
  pgDatabase: string;
  objectPrefix: string;
  qdrantShardKey: string;
  opensearchIndex: string;
  opensearchAlias: string;
  temporalQueuePrefix: string;
  litellmTeam: string;
  kmsKeyRef: string;
  keycloakOrgId?: string;
}

export interface Usage {
  questionsMonth: number;
  llmTokensMonth: number;
  storageGb: number;
  vectors: number;
  costMonthINR: number;
}

export interface SourceHealthRow {
  sourceId: string;
  name: string;
  type: "gmail" | "drive" | "sheets" | "whatsapp" | "file_drop";
  health: "ok" | "degraded" | "failing" | "auth_error" | "syncing";
  lastSyncAt: string;
  lagMinutes: number;
  itemsPerDay: number;
  errorRate: number;
  deadLetters: number;
}

export interface AdminTenant {
  tenantId: string;
  slug: string;
  name: string;
  tier: Tier;
  plan: Plan;
  status: TenantStatus;
  isSynthetic: boolean;
  createdAt: string;
  placement: Placement;
  usage: Usage;
  sources: SourceHealthRow[];
  provisioning?: { startedAt: string };
}

export interface OpAudit {
  id: string;
  at: string;
  operator: string;
  action: string;
  tenant?: string;
  reason?: string;
  detail?: string;
}

export interface Chunk {
  chunkId: string;
  title: string;
  sourceType: string;
  text: string;
  acl: string[]; // prefixed tokens, as indexed (EB-42)
}

/** ProvisionTenant workflow steps (foundation-fit §4.4). Each takes ~1.5 s in the simulation. */
export const PROVISION_STEPS = [
  "Registry row",
  "Keycloak organization + admin invite",
  "OpenFGA tuples",
  "Encryption key (KMS)",
  "Storage prefix",
  "OpenSearch alias",
  "Qdrant placement",
  "LiteLLM team and budget",
  "Temporal queue and fairness weight",
  "Seed industry pack",
];
const STEP_MS = 1500;

export function placementFor(tenantId: string, tier: Tier): Placement {
  const dedicated = tier !== "pool";
  return {
    cellId: "pool-in-1",
    region: "ap-south-2",
    pgDatabase: dedicated ? `brain_${tenantId.replace(/-/g, "_")}` : "brain",
    objectPrefix: `tenants/${tenantId}/`,
    qdrantShardKey: dedicated ? tenantId : "pool",
    opensearchIndex: dedicated ? `docs-${tenantId}` : "docs",
    opensearchAlias: `tenant-${tenantId}`,
    temporalQueuePrefix: dedicated ? `t-${tenantId}` : "pool",
    litellmTeam: `tenant-${tenantId}`,
    kmsKeyRef: `alias/klarity-tenant-${tenantId}`,
  };
}

const SEED: AdminTenant[] = [
  {
    tenantId: "0fdc5142-8c25-41c5-aab4-0a88db52a5bf",
    slug: "studio8",
    name: "Studio 8 Hats",
    tier: "pool",
    plan: "pilot",
    status: "active",
    isSynthetic: false,
    createdAt: "2026-09-20T10:00:00+05:30",
    placement: { ...placementFor("0fdc5142-8c25-41c5-aab4-0a88db52a5bf", "pool"), keycloakOrgId: "kc-org-studio8" },
    usage: { questionsMonth: 412, llmTokensMonth: 3_860_000, storageGb: 18.4, vectors: 212_000, costMonthINR: 14_850 },
    sources: [
      { sourceId: "src-gmail-partners", name: "Partners mailbox", type: "gmail", health: "ok", lastSyncAt: "2026-09-30T11:57:00+05:30", lagMinutes: 3, itemsPerDay: 184, errorRate: 0.002, deadLetters: 0 },
      { sourceId: "src-gmail-accounts", name: "Accounts mailbox", type: "gmail", health: "auth_error", lastSyncAt: "2026-09-28T09:10:00+05:30", lagMinutes: 2 * 24 * 60 + 170, itemsPerDay: 0, errorRate: 1, deadLetters: 14 },
      { sourceId: "src-drive", name: "Projects shared drive", type: "drive", health: "ok", lastSyncAt: "2026-09-30T11:50:00+05:30", lagMinutes: 10, itemsPerDay: 36, errorRate: 0.004, deadLetters: 0 },
      { sourceId: "src-sheets", name: "Finance workbook", type: "sheets", health: "ok", lastSyncAt: "2026-09-30T11:45:00+05:30", lagMinutes: 15, itemsPerDay: 22, errorRate: 0, deadLetters: 0 },
      { sourceId: "src-whatsapp", name: "Phoenix client group (export)", type: "whatsapp", health: "degraded", lastSyncAt: "2026-09-30T08:00:00+05:30", lagMinutes: 240, itemsPerDay: 95, errorRate: 0.031, deadLetters: 2 },
    ],
  },
  {
    tenantId: "1bae9ff8-abf9-44bf-9b17-a5cb2c83d71b",
    slug: "synthetic-canary",
    name: "Synthetic canary",
    tier: "pool",
    plan: "pilot",
    status: "active",
    isSynthetic: true,
    createdAt: "2026-09-20T10:05:00+05:30",
    placement: { ...placementFor("1bae9ff8-abf9-44bf-9b17-a5cb2c83d71b", "pool"), keycloakOrgId: "kc-org-canary" },
    usage: { questionsMonth: 1_260, llmTokensMonth: 910_000, storageGb: 0.2, vectors: 40, costMonthINR: 1_120 },
    sources: [],
  },
];

const CORPUS: Record<string, Chunk[]> = {
  studio8: [
    { chunkId: "c1", title: "Phoenix client group", sourceType: "WhatsApp", text: "We prefer the HPL panels over ACP for the front facade even if it costs more — please go ahead and update the drawings.", acl: ["group:project-phoenix"] },
    { chunkId: "c2", title: "Revised quotation — facade cladding (HPL)", sourceType: "Email", text: "Switching the front facade from ACP to HPL changes the cladding package from ₹14,80,000 to ₹24,00,000 including fixing system.", acl: ["group:project-phoenix", "user:accounts@studio8.example"] },
    { chunkId: "c3", title: "PHX-STR-204 Rev C", sourceType: "Drawing", text: "Transfer beam at level 2 revised from RCC to steel section ISMB 600 following the column shift. Supersedes Rev B.", acl: ["group:project-phoenix", "group:consultants"] },
    { chunkId: "c4", title: "Site update — week 36", sourceType: "Email", text: "Steel delivery slipped by 3 weeks; masonry and MEP crews were retained on site to hold the schedule.", acl: ["group:project-phoenix"] },
    { chunkId: "c5", title: "Variation order VO-07", sourceType: "Document", text: "VO-07: Facade material change ACP → HPL. Amount ₹9,20,000. Status: sent to client for signature. Signature: pending.", acl: ["group:partners", "user:accounts@studio8.example"] },
    { chunkId: "c6", title: "Re: RA-2 payment", sourceType: "Email", text: "We will process RA-2 after the board meeting. Please bear with us for a few more days.", acl: ["group:partners", "user:accounts@studio8.example"] },
    { chunkId: "c7", title: "MC-MEP-110 Rev C", sourceType: "Drawing", text: "OT air changes increased to 25 per hour with HEPA terminal filters; AHU relocated to the terrace.", acl: ["group:project-marigold"] },
    { chunkId: "c8", title: "Snag list — 28 Sep", sourceType: "Document", text: "Open snags: 42 (civil 11, MEP 17, finishes 14). Critical: 3 (fire damper, DB labelling, emergency lighting).", acl: ["group:project-banyan"] },
  ],
  "synthetic-canary": [
    { chunkId: "k1", title: "CANARY-7f3e canary document", sourceType: "Document", text: "CANARY-7f3e canary ledger row: amount ₹4,56,789 for the canary build.", acl: ["public"] },
  ],
};

export const SEARCH_AS: { id: string; label: string; tokens: string[] | "all" }[] = [
  { id: "all", label: "Index view (no user filter)", tokens: "all" },
  { id: "partner", label: "A partner", tokens: ["public", "group:partners", "group:project-phoenix", "group:project-marigold", "group:project-banyan"] },
  { id: "accounts", label: "Accounts", tokens: ["public", "user:accounts@studio8.example"] },
  { id: "consultant", label: "Structural consultant (guest)", tokens: ["public", "group:consultants"] },
];

interface State {
  tenants: AdminTenant[];
  audit: OpAudit[];
  seq: number;
}
const g = globalThis as unknown as { __klarityAdmin?: State };
const state: State = (g.__klarityAdmin ??= {
  tenants: structuredClone(SEED),
  audit: [{ id: "oa-1", at: "2026-09-20T10:00:00+05:30", operator: "Platform", action: "tenant.provision", tenant: "studio8", detail: "Registered from control-plane seed" }],
  seq: 2,
});

function settle(now = Date.now()): void {
  for (const t of state.tenants) {
    if (t.status === "provisioning" && t.provisioning) {
      if (now - new Date(t.provisioning.startedAt).getTime() >= STEP_MS * PROVISION_STEPS.length) {
        t.status = "active";
        t.placement.keycloakOrgId = `kc-org-${t.slug}`;
      }
    }
  }
}

export function provisioningStep(t: AdminTenant, now = Date.now()): number {
  if (!t.provisioning) return PROVISION_STEPS.length;
  return Math.min(PROVISION_STEPS.length, Math.floor((now - new Date(t.provisioning.startedAt).getTime()) / STEP_MS));
}

export function listTenants(): AdminTenant[] {
  settle();
  return state.tenants;
}

export function getTenant(id: string): AdminTenant | undefined {
  settle();
  return state.tenants.find((t) => t.tenantId === id);
}

export function corpusFor(t: AdminTenant): Chunk[] {
  return CORPUS[t.slug] ?? [];
}

export function auditLog(): OpAudit[] {
  return [...state.audit].sort((a, b) => b.at.localeCompare(a.at));
}

export class AdminError extends Error {}

export function audit(operator: string, action: string, tenant?: string, reason?: string, detail?: string): void {
  state.audit.push({ id: `oa-${state.seq++}`, at: new Date().toISOString(), operator, action, tenant, reason, detail });
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;

export function provisionTenant(operator: string, input: { name: string; slug: string; tier: string; plan: string }): AdminTenant {
  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();
  if (name.length < 2) throw new AdminError("enter the organisation's name");
  if (!SLUG.test(slug)) throw new AdminError("slug: lowercase letters, digits and hyphens, 2–63 characters");
  if (state.tenants.some((t) => t.slug === slug)) throw new AdminError("that slug is taken");
  if (input.tier !== "pool" && input.tier !== "bridge") throw new AdminError("silo tenants need a dedicated cell; choose pool or bridge");
  if (!(PLANS as readonly string[]).includes(input.plan)) throw new AdminError("unknown plan");
  const tenantId = crypto.randomUUID();
  const t: AdminTenant = {
    tenantId,
    slug,
    name,
    tier: input.tier,
    plan: input.plan as Plan,
    status: "provisioning",
    isSynthetic: false,
    createdAt: new Date().toISOString(),
    placement: placementFor(tenantId, input.tier),
    usage: { questionsMonth: 0, llmTokensMonth: 0, storageGb: 0, vectors: 0, costMonthINR: 0 },
    sources: [],
    provisioning: { startedAt: new Date().toISOString() },
  };
  state.tenants.push(t);
  audit(operator, "tenant.provision", slug, undefined, `${input.tier} · ${input.plan}`);
  return t;
}

export function setStatus(operator: string, tenantId: string, status: "active" | "suspended", reason: string): AdminTenant {
  const t = getTenant(tenantId);
  if (!t) throw new AdminError("tenant not found");
  if (reason.trim().length < 10) throw new AdminError("give a reason of at least 10 characters");
  if (t.status === "provisioning") throw new AdminError("wait for provisioning to finish");
  if (status === "suspended" && t.status !== "active") throw new AdminError("only active tenants can be suspended");
  if (status === "active" && t.status !== "suspended") throw new AdminError("only suspended tenants can be resumed");
  t.status = status;
  audit(operator, status === "suspended" ? "tenant.suspend" : "tenant.resume", t.slug, reason.trim());
  return t;
}

export function changePlan(operator: string, tenantId: string, plan: string, reason: string): AdminTenant {
  const t = getTenant(tenantId);
  if (!t) throw new AdminError("tenant not found");
  if (!(PLANS as readonly string[]).includes(plan)) throw new AdminError("unknown plan");
  if (reason.trim().length < 10) throw new AdminError("give a reason of at least 10 characters");
  const before = t.plan;
  t.plan = plan as Plan;
  audit(operator, "tenant.change_plan", t.slug, reason.trim(), `${before} → ${plan}`);
  return t;
}
