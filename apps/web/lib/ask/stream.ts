// Owner task: EB-96 Streaming answers — the wire format between /api/ask and the Ask page (NDJSON, one event
// per line). Evidence is always sent before any segment or section that cites it, and the final `done` event
// carries the complete contract, which replaces whatever was assembled from the stream.
import type { AnswerContract, Claim, Evidence, Risk, Segment, SuggestedAction } from "../contracts";

export type StreamEvent =
  | { type: "stage"; index: number }
  | { type: "evidence"; evidence: Evidence[] }
  | { type: "segment"; segment: Segment }
  | { type: "facts"; facts: Claim[] }
  | { type: "causes"; causes: Claim[] }
  | { type: "risks"; risks: Risk[] }
  | { type: "unknowns"; unknowns: string[] }
  | { type: "done"; contract: AnswerContract }
  | { type: "error"; message: string };

export const STAGES = ["Understanding the question", "Searching sources you can access", "Checking every claim against evidence"];

/** Server side: the sequence of events for a finished contract. */
export function eventsFor(c: AnswerContract): StreamEvent[] {
  return [
    { type: "stage", index: 1 },
    { type: "evidence", evidence: c.evidence },
    { type: "stage", index: 2 },
    ...c.answer.map((segment) => ({ type: "segment" as const, segment })),
    { type: "facts", facts: c.facts },
    { type: "causes", causes: c.causes },
    { type: "risks", risks: c.risks },
    { type: "unknowns", unknowns: c.unknowns },
    { type: "done", contract: c },
  ];
}

export interface PartialAnswer {
  stage: number;
  evidence: Evidence[];
  answer: Segment[];
  facts: Claim[];
  causes: Claim[];
  risks: Risk[];
  unknowns: string[];
  actions: SuggestedAction[];
}

export const EMPTY_PARTIAL: PartialAnswer = { stage: 0, evidence: [], answer: [], facts: [], causes: [], risks: [], unknowns: [], actions: [] };

/** Client side: fold one event into the partial answer. Claims whose evidence has not arrived are dropped. */
export function apply(p: PartialAnswer, e: StreamEvent): PartialAnswer {
  const known = new Set(p.evidence.map((x) => x.id));
  const cited = (ids?: string[]) => !ids || ids.every((id) => known.has(id));
  switch (e.type) {
    case "stage":
      return { ...p, stage: e.index };
    case "evidence":
      return { ...p, evidence: [...p.evidence, ...e.evidence] };
    case "segment":
      return cited(e.segment.evidenceIds) ? { ...p, answer: [...p.answer, e.segment] } : p;
    case "facts":
      return { ...p, facts: e.facts.filter((c) => cited(c.evidenceIds)) };
    case "causes":
      return { ...p, causes: e.causes.filter((c) => cited(c.evidenceIds)) };
    case "risks":
      return { ...p, risks: e.risks.filter((c) => cited(c.evidenceIds)) };
    case "unknowns":
      return { ...p, unknowns: e.unknowns };
    default:
      return p;
  }
}
