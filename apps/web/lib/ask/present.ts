// Owner task: EB-50 Ask Brain UI — how an AnswerContract is laid out as bento cards. Pure functions over the
// contract; they choose and order what is shown but never compute a figure (CLAUDE.md rule 3): every amount on
// screen is a `figure` the contract already carries, with its SQL origin.
import type { AnswerContract, Claim, Evidence } from "../contracts";

export interface FigureRow {
  id: string;
  label: string;
  amount: number;
  /** Share of the largest row, 0–100, for the bar length only. */
  pct: number;
  query?: string;
  evidenceIds: string[];
}

/** The headline figure: the claim named f-total, else the first claim that carries a figure. */
export function leadFigure(a: Pick<AnswerContract, "facts">): Claim | undefined {
  return a.facts.find((f) => f.id === "f-total" && f.figure) ?? a.facts.find((f) => f.figure);
}

/** Every other figure-bearing claim, largest first, with a bar length relative to the largest. */
export function figureRows(a: Pick<AnswerContract, "facts">): FigureRow[] {
  const lead = leadFigure(a);
  const rows = a.facts.filter((f) => f.figure && f !== lead);
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.figure!.amount)));
  return rows
    .map((f) => ({ id: f.id, label: f.text, amount: f.figure!.amount, pct: (Math.abs(f.figure!.amount) / max) * 100, query: f.figure!.query, evidenceIds: f.evidenceIds }))
    .sort((x, y) => y.amount - x.amount);
}

export interface CitationStats {
  /** Statements that make a claim: facts, causes and risks. */
  claims: number;
  /** …of which cite at least one source. The contract validators require all of them. */
  cited: number;
  sources: number;
}

export function citationStats(a: Pick<AnswerContract, "facts" | "causes" | "risks" | "evidence">): CitationStats {
  const all = [...a.facts, ...a.causes, ...a.risks];
  return { claims: all.length, cited: all.filter((c) => c.evidenceIds.length > 0).length, sources: a.evidence.length };
}

/** What each piece of evidence is cited for, so the side-sheet can say "Used to support …". */
export function citedFor(a: Pick<AnswerContract, "facts" | "causes" | "risks">, evidenceId: string): string[] {
  return [...a.facts, ...a.causes, ...a.risks].filter((c) => c.evidenceIds.includes(evidenceId)).map((c) => c.text);
}

/** "E1" for the first source of the answer; used for the citation chips. */
export function chipLabel(a: Pick<AnswerContract, "evidence">, evidenceId: string): string | undefined {
  const i = a.evidence.findIndex((e) => e.id === evidenceId);
  return i < 0 ? undefined : `E${i + 1}`;
}

export function evidenceById(a: Pick<AnswerContract, "evidence">): Map<string, Evidence> {
  return new Map(a.evidence.map((e) => [e.id, e]));
}
