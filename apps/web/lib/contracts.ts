// Owner task: EB-50 Ask Brain UI — TypeScript view of the answer contract.
//
// PROVISIONAL: the canonical schema is EB-47 (packages/schemas/answer_contract), still a stub. This file
// is the UI's proposal; when EB-47 lands, generate these types from it and delete the hand-written ones.
// CLAUDE.md rules reflected here: answers carry evidence (rule 4); figures carry their SQL origin (rule 3).

export const ANSWER_CONTRACT_VERSION = "0.1-ui-draft";

export type SourceType = "email" | "whatsapp" | "sheet" | "document" | "drawing" | "meeting";
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
  highlight: { start: number; end: number }; // span inside `excerpt` that supports the claim
  openUrl?: string; // deep link to the source system, when the user may open it
}

export interface Figure {
  amount: number;
  currency: "INR";
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

export interface Risk extends Claim {
  severity: "high" | "medium" | "low";
}

export interface SuggestedAction {
  id: string;
  label: string;
  kind: "draft_message" | "create_task" | "open_source";
  requiresApproval: boolean; // CLAUDE.md rule 10: side effects go through the approval model
}

export interface AnswerContract {
  version: string;
  question: string;
  status: AnswerStatus;
  answer: Segment[];
  facts: Claim[];
  causes: Claim[];
  risks: Risk[];
  unknowns: string[];
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
