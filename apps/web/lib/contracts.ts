// Owner task: EB-50 Ask Brain UI — TypeScript view of the canonical answer contract.
//
// The canonical schema is packages/schemas/answer_contract/schema.py (EB-47, pydantic). This file mirrors it field
// for field (camelCase aliases on the wire). Drift is caught from both sides: tests/contract-fixtures.test.ts
// writes the contracts this app produces to packages/schemas/answer_contract/fixtures, and
// packages/schemas/tests validates every fixture with the pydantic model and pins the JSON Schema.
// CLAUDE.md rules reflected here: answers carry evidence (rule 4); figures carry their SQL origin (rule 3).

export const ANSWER_CONTRACT_VERSION = "1.1.0";

export type SourceType = "email" | "whatsapp" | "sheet" | "document" | "drawing" | "meeting" | "ledger" | "sql";

/** Box on a page, normalised 0..1 of page width/height, origin top-left. */
export interface EvidenceBBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The table and cell range the evidence was read from, as recognised by Docling TableFormer. */
export interface EvidenceTableRef {
  tableId: string;
  caption?: string;
  rowStart: number;
  rowEnd: number;
  colStart?: number;
  colEnd?: number;
}

export interface EvidenceLocator {
  page?: number; // 1-indexed
  bbox?: EvidenceBBox;
  table?: EvidenceTableRef;
  parser?: "docling" | "tika" | "ocr" | "native";
}
export type ConfidenceLevel = "high" | "medium" | "low";
export type AnswerStatus = "answered" | "partial" | "insufficient_evidence" | "no_access";

export interface Evidence {
  id: string;
  sourceType: SourceType;
  title: string;
  author?: string;
  occurredAt?: string; // ISO 8601
  project?: string;
  excerpt: string; // the source passage shown in the source panel
  highlight?: { start: number; end: number }; // span inside `excerpt` that supports the claim
  openUrl?: string; // deep link to the source system, when the user may open it
  locator?: EvidenceLocator; // page / bounding box / table range in the original file
}

export interface Figure {
  amount: number;
  currency: "INR" | "USD";
  origin: "sql"; // numbers only ever come from SQL, never from the model
  query?: string; // named, reviewed query that produced the number
}

/** A sentence-level piece of the answer; `evidenceIds` become inline citation chips. */
export interface Segment {
  text: string;
  evidenceIds?: string[];
}

export interface Claim {
  id: string;
  text: string;
  evidenceIds: string[];
  figure?: Figure;
}

export interface Risk {
  id: string;
  text: string;
  evidenceIds: string[];
  severity: "high" | "medium" | "low";
  figure?: Figure;
}

export interface SuggestedAction {
  id: string;
  label: string;
  kind: "draft_message" | "create_task" | "open_source";
  requiresApproval: boolean; // CLAUDE.md rule 10: side effects go through the approval model
  /** What goes to Approvals when the user accepts the suggestion. Nothing is sent before approval. */
  draft?: { title: string; body: string; reason: string; evidenceIds: string[]; projectId?: string };
}

export interface AnswerContract {
  version: string;
  question: string;
  status: AnswerStatus;
  summary: string;
  answer: Segment[];
  facts: Claim[];
  causes: Claim[];
  risks: Risk[];
  unknowns: string[];
  conflicts: string[];
  confidence: { level: ConfidenceLevel; reason: string };
  actions: SuggestedAction[];
  evidence: Evidence[];
  generatedAt: string;
}

export const FEEDBACK_REASONS = ["wrong_fact", "missing_source", "outdated", "not_what_i_asked", "other"] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];
export const FEEDBACK_REASON_LABELS: Record<FeedbackReason, string> = {
  wrong_fact: "A fact is wrong",
  missing_source: "Missing or wrong source",
  outdated: "Out of date",
  not_what_i_asked: "Not what I asked",
  other: "Something else",
};
