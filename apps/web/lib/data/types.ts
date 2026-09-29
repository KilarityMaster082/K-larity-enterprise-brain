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
  connectorType: "gmail" | "drive" | "sheets" | "whatsapp" | "file_drop";
  displayName: string;
  account: string;
  health: SourceHealth;
  lastSyncAt?: string;
  itemsSeen: number;
  errorRate: number; // 0–1 over the last 24 h
  lagMinutes?: number;
  lastError?: string;
  connectedAt: string;
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
}
