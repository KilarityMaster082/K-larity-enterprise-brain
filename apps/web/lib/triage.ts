// Owner task: EB-53 Decision Memory with review UI — two-tier decision triage. Tier 1 is the draft queue the extractor
// fills from email and chat; a person confirms, edits or rejects each draft. Tier 2 is the confirmed log. This orders
// tier 1 so the drafts that need a careful look come first, and says why. It never decides anything: only a person does.
import type { Decision } from "./data/types";

export const LOW_CONFIDENCE = 0.75;
/** Cost impact at or above this (rupees) needs a careful look. */
export const HIGH_IMPACT = 100_000;

export interface TriagedDraft<T extends Decision = Decision> {
  decision: T;
  needsCare: boolean;
  reasons: string[];
}

/** `costImpact` must already be removed for roles without finance.view, so the ordering never leaks a magnitude. */
export function triageDrafts<T extends Decision>(drafts: T[]): TriagedDraft<T>[] {
  return drafts
    .filter((d) => d.status === "proposed")
    .map((decision) => {
      const reasons: string[] = [];
      if (decision.confidence !== undefined && decision.confidence < LOW_CONFIDENCE) reasons.push(`Extraction confidence ${Math.round(decision.confidence * 100)}%: check the source`);
      if (decision.costImpact !== undefined && Math.abs(decision.costImpact) >= HIGH_IMPACT) reasons.push("Changes the cost by more than ₹1 lakh");
      if (decision.evidenceIds.length < 2) reasons.push("Rests on a single source");
      return { decision, needsCare: reasons.length > 0, reasons };
    })
    .sort(
      (a, b) =>
        Number(b.needsCare) - Number(a.needsCare) ||
        b.reasons.length - a.reasons.length ||
        Math.abs(b.decision.costImpact ?? 0) - Math.abs(a.decision.costImpact ?? 0) ||
        (a.decision.confidence ?? 1) - (b.decision.confidence ?? 1) ||
        a.decision.decisionId.localeCompare(b.decision.decisionId),
    );
}

/** Whether a member may review: only drafts on projects they lead (partners and owners review everything). */
export function canReviewDraft(role: string, leadName: string | undefined, userName: string): boolean {
  if (role === "owner" || role === "admin") return true;
  return role === "member" && leadName !== undefined && leadName === userName;
}
