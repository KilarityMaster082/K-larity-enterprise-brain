// Owner task: EB-23 Web UI shell — the web app's view of tenant data. Field names follow db/migrations/
// 0001_initial.sql (projects, events, documents, decisions, finance_txns, users) so the dev repository can be
// swapped for API calls (apps/api) without touching pages. Money is INR in rupees; timestamps are ISO 8601.
import type { Evidence } from "../contracts";

export type Role = "owner" | "admin" | "member" | "viewer" | "guest";

export interface Person {
  personId: string;
  name: string; // role label in demo data, e.g. "Project lead"
  org: string;
  kind: "staff" | "client" | "vendor" | "consultant";
}

export interface Project {
  projectId: string;
  name: string;
  code: string;
  client: string;
  location: string;
  description: string;
  status: "active" | "on_hold" | "completed" | "archived";
  /** Stage names come from the tenant's industry pack (packs/aec), never from core code. */
  stages: string[];
  currentStage: number;
  budget: number;
  leadId: string;
  peopleIds: string[];
  startedOn: string;
  dueOn: string;
}

export interface BudgetLine {
  projectId: string;
  package: string;
  budget: number;
}

export type TxnType = "invoice" | "payment" | "credit_note" | "debit_note" | "change_order";
export type TxnStatus = "pending" | "completed" | "overdue" | "cancelled" | "disputed";

export interface FinanceTxn {
  txnId: string;
  projectId: string;
  txnType: TxnType;
  txnRef: string;
  amount: number;
  /** receivable = billed to the client; payable = owed to a vendor (metadata.direction in the DB). */
  direction: "receivable" | "payable";
  package?: string;
  status: TxnStatus;
  counterparty: string;
  txnDate: string;
  dueDate?: string;
  evidenceId: string;
}

export interface ProjectEvent {
  eventId: string;
  projectId: string;
  eventType: "message" | "email" | "drawing" | "decision" | "invoice" | "payment" | "site" | "risk";
  occurredAt: string;
  title: string;
  description?: string;
  evidenceId?: string;
}

export interface DocumentItem {
  documentId: string;
  projectId: string;
  title: string;
  docType: "drawing" | "quotation" | "invoice" | "report" | "contract" | "minutes";
  series?: string; // drawings: sheet number, e.g. PHX-STR-204
  revision?: string;
  isLatest: boolean;
  source: "drive" | "gmail" | "whatsapp" | "sheets" | "file_drop";
  updatedAt: string;
  sizeBytes: number;
  summary: string;
  facts: string[];
  evidenceId: string;
  /** Contracts and variations: whether the counterparty has signed. */
  signed?: boolean;
  /** Contracts, quotations and variations: value in rupees. */
  amount?: number;
  /** Original file name; its extension decides which viewer opens (screens 30–37). */
  fileName?: string;
}

export type DecisionStatus = "proposed" | "decided" | "superseded" | "revoked";

export interface Decision {
  decisionId: string;
  projectId: string;
  title: string;
  description: string;
  rationale?: string;
  status: DecisionStatus;
  decidedBy?: string;
  decidedAt?: string;
  supersededBy?: string;
  alternatives: string[];
  costImpact?: number;
  timeImpactDays?: number;
  evidenceIds: string[];
  /** For drafts: how sure the extractor is (0–1). */
  confidence?: number;
  reviewedBy?: string;
  reviewNote?: string;
}

export type ApprovalKind = "draft_message" | "create_task" | "update_record";
export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface Approval {
  approvalId: string;
  kind: ApprovalKind;
  title: string;
  body: string;
  projectId?: string;
  requestedBy: string;
  requestedVia: "ask_brain" | "agent" | "person";
  requestedAt: string;
  reason: string;
  evidenceIds: string[];
  status: ApprovalStatus;
  decidedBy?: string;
  decidedAt?: string;
  note?: string;
}

export type SourceHealth = "ok" | "degraded" | "failing" | "auth_error" | "syncing" | "never_run";

export interface Source {
  sourceId: string;
  connectorType: "gmail" | "drive" | "sheets" | "whatsapp" | "file_drop" | "calendar";
  displayName: string;
  account: string;
  health: SourceHealth;
  lastSyncAt?: string;
  itemsSeen: number;
  errorRate: number; // 0–1 over the last 24 h
  lagMinutes?: number;
  lastError?: string;
  connectedAt: string;
  /** Start of the running sync: the first sync after connecting, or a manual "Sync now". */
  syncStartedAt?: string;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: Role;
  status: "active" | "invited" | "disabled";
  lastActiveAt?: string;
}

export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string;
  detail?: string;
}

// ---------------------------------------------------------------- workspace domains (screens 5–11, 19–41, 38–39)
export type MailCategory = "Tender" | "RFI" | "Change Order" | "Invoices" | "General";
export type Tone = "lime" | "sky" | "lavender" | "pink" | "green" | "cream";

export interface MailMessage {
  messageId: string;
  fromName: string;
  fromOrg: string;
  at: string;
  body: string;
  /** Quoted earlier messages collapsed under this one. */
  quoted?: number;
  /** The reply that carries the decision (drawn with the lime rule). */
  decisive?: boolean;
}

export interface MailThread {
  threadId: string;
  projectId?: string;
  subject: string;
  fromName: string;
  fromOrg: string;
  category: MailCategory;
  folder: "inbox" | "sent";
  starred: boolean;
  unread: boolean;
  lastAt: string;
  messages: MailMessage[];
  attachments: { name: string; documentId?: string }[];
  /** What the extractor found; drafts become proposed decisions when a person sends them to the log. */
  extraction: {
    decisions: { text: string; decisionId?: string }[];
    commitments: { text: string; due: string }[];
    variations: { text: string; amount: number; evidenceId?: string }[];
  };
  evidenceId?: string;
  /** Threads that quote money are finance-gated for roles without finance.view. */
  financial?: boolean;
}

export interface KnowledgeStats {
  chunks: number;
  chunksDeltaMonth: number;
  storageGb: number;
  storageCapGb: number;
  pipeline: { stage: string; health: "ok" | "degraded" | "failing" }[];
  sets: { name: string; count: number; tone: Tone }[];
}

export interface VaultFolder {
  folderId: string;
  parentId?: string;
  name: string;
  projectId?: string;
}

export interface VaultFile {
  fileId: string;
  folderId: string;
  name: string;
  ext: string;
  updatedAt: string;
  meta: string;
  status: "parsed" | "ocr" | "uploading" | "failed";
  progress: number;
  documentId?: string;
  /** When an upload began; progress and status are derived from the clock until parsing finishes. */
  startedAt?: string;
}

export interface BaseColumn {
  key: string;
  label: string;
  kind: "text" | "rating" | "number" | "status" | "money";
}

export interface BaseTableData {
  baseId: string;
  name: string;
  columns: BaseColumn[];
  rows: Record<string, string | number>[];
}

export interface GraphNodeData {
  id: string;
  label: string;
  kind: "project" | "vendor" | "drawing" | "milestone" | "decision" | "subcontract" | "client";
  x: number;
  y: number;
  r: number;
  tone: Tone;
  evidenceIds: string[];
}

export interface KnowledgeGraphData {
  nodes: GraphNodeData[];
  edges: [string, string][];
}

export interface Meeting {
  meetingId: string;
  title: string;
  projectId?: string;
  startsAt: string;
  endsAt: string;
  kind: "site" | "client" | "vendor" | "internal";
  attendees: { name: string; org: string }[];
  status: "upcoming" | "live" | "past";
  agenda: string[];
  /** Pre-meeting brief compiled from the tenant's own data; every line cites evidence. */
  prep?: {
    openCommitments: { text: string; owner: string; evidenceId?: string }[];
    pendingApprovalIds: string[];
    newRevisions: { documentId: string; note: string }[];
    attendeeNotes: { name: string; note: string }[];
  };
  transcript?: { at: string; speaker: string; text: string; flag?: "action" | "decision" | "keyword" }[];
  summary?: string;
}

export interface Todo {
  todoId: string;
  text: string;
  projectId?: string;
  assignee: string;
  dueOn?: string;
  done: boolean;
  source: { kind: "email" | "meeting" | "document" | "whatsapp"; label: string; evidenceId?: string };
}

export type AgentStatus = "running" | "ok" | "retrying" | "failed" | "queued";

export interface AgentStep {
  at: string;
  tool: string;
  detail: string;
  tokens: number;
  error?: string;
}

export interface AgentRun {
  runId: string;
  jobId: string;
  startedAt: string;
  status: AgentStatus;
  attempt: number;
  steps: AgentStep[];
}

export interface AgentJob {
  jobId: string;
  name: string;
  description: string;
  schedule: string;
  status: AgentStatus;
  lastRunAt: string;
  durationSec: number;
  tokensToday: number;
  runs: AgentRun[];
}

export interface SpaceMessage {
  messageId: string;
  author: string;
  at: string;
  text: string;
  mentions?: string[];
  documentId?: string;
  reactions?: { emoji: string; count: number }[];
  replies?: { author: string; at: string; text: string }[];
}

export interface Space {
  spaceId: string;
  name: string;
  topic: string;
  projectId?: string;
  members: string[];
  unread: number;
  pinnedDocumentIds: string[];
  messages: SpaceMessage[];
  agentRuns: number;
}

export interface ActivityItem {
  id: string;
  at: string;
  actor: string;
  verb: "uploaded" | "confirmed" | "approved" | "synced" | "rejected" | "joined" | "commented";
  target: string;
  projectId?: string;
}

export interface AppDef {
  appId: string;
  name: string;
  vendor: string;
  kind: "connector" | "mcp";
  description: string;
  scopes: string[];
  /** Scopes the owner has switched off; the rest are synced. */
  disabledScopes?: string[];
  status: "connected" | "available" | "attention";
  /** Source rows this app feeds (Settings → Sources). */
  connectorType?: Source["connectorType"];
  oauth: "granted" | "expired" | "not_connected";
  webhookPath?: string;
  lastSyncAt?: string;
  category: "Email & chat" | "Files" | "Finance" | "Calendar" | "Construction" | "Design";
}

export interface HistoryItem {
  historyId: string;
  at: string;
  question: string;
  projectId?: string;
  topic: string;
  helpful?: boolean;
  userId: string;
}

export type SheetCell = string | number | { f: string };

export type FileContent =
  | { kind: "xlsx"; sheets: { name: string; columns: string[]; rows: SheetCell[][]; freezeRows: number; freezeCols: number; currencyColumns?: number[] }[] }
  | { kind: "pdf"; pages: { n: number; heading: string; lines: string[]; marks?: { line: number; start: number; end: number }[] }[] }
  | { kind: "docx"; blocks: { type: "h1" | "h2" | "p" | "li"; text: string }[] }
  | { kind: "pptx"; slides: { title: string; bullets: string[]; notes?: string }[] }
  | { kind: "image"; caption: string; takenAt: string; location: string; width: number; height: number; tags: string[] }
  | { kind: "video"; durationSec: number; chapters: { at: number; label: string }[]; captions: { at: number; text: string }[] }
  | { kind: "audio"; durationSec: number; from: string; transcript: { at: number; text: string }[] }
  | { kind: "code"; language: string; path: string; before: string; after: string };

export interface RetentionPolicy {
  days: number;
  auditExportAt?: string;
  kmsKeyAlias: string;
  kmsKeyState: "active" | "rotating" | "disabled";
  lastRotatedAt: string;
}

export interface WorkspaceDataset {
  mail: MailThread[];
  knowledge: KnowledgeStats;
  folders: VaultFolder[];
  files: VaultFile[];
  bases: BaseTableData[];
  graph: KnowledgeGraphData;
  meetings: Meeting[];
  todos: Todo[];
  jobs: AgentJob[];
  spaces: Space[];
  activity: ActivityItem[];
  apps: AppDef[];
  history: HistoryItem[];
  retention: RetentionPolicy;
  /** Daily token allowance for background agents (from the tenant's LLM gateway budget). */
  agentTokenCap: number;
  /** Parsed content of files the viewers can open, by document id. */
  contents: Record<string, FileContent>;
}

export interface TenantDataset {
  people: Person[];
  projects: Project[];
  budgetLines: BudgetLine[];
  txns: FinanceTxn[];
  events: ProjectEvent[];
  documents: DocumentItem[];
  decisions: Decision[];
  approvals: Approval[];
  sources: Source[];
  members: Member[];
  audit: AuditEvent[];
  evidence: Evidence[];
  workspace: WorkspaceDataset;
}
