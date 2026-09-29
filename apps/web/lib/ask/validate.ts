// Owner task: EB-95 Answer contract types generated from the schema (interim guard) — a runtime check that an
// AnswerContract obeys the trust rules, independent of who produced it. Until EB-47 publishes the schema and the
// types are generated from it, this is the UI's contract test: dev answers, fixtures and (later) engine answers
// all pass through it in tests. It returns a list of problems; empty means valid.
import type { AnswerContract } from "../contracts";

export function validateContract(c: AnswerContract): string[] {
  const problems: string[] = [];
  const ids = new Set(c.evidence.map((e) => e.id));
  if (ids.size !== c.evidence.length) problems.push("duplicate evidence ids");

  for (const e of c.evidence) {
    const { start, end } = e.highlight;
    if (!(start >= 0 && end > start && end <= e.excerpt.length)) problems.push(`evidence ${e.id}: highlight is outside the excerpt`);
  }

  const cites = (where: string, list?: string[]) => {
    for (const id of list ?? []) if (!ids.has(id)) problems.push(`${where} cites unknown evidence ${id}`);
  };
  const answered = c.status === "answered" || c.status === "partial";

  if (answered) {
    c.answer.forEach((s, i) => cites(`answer[${i}]`, s.evidenceIds));
    if (!c.answer.some((s) => s.evidenceIds?.length)) problems.push("an answered contract has no cited statement");
  }
  for (const f of c.facts) {
    if (!f.evidenceIds.length) problems.push(`fact ${f.id} has no evidence`);
    cites(`fact ${f.id}`, f.evidenceIds);
    if (f.figure && f.figure.origin !== "sql") problems.push(`fact ${f.id}: figures must come from SQL`);
    if (f.figure && !Number.isFinite(f.figure.amount)) problems.push(`fact ${f.id}: figure is not a number`);
  }
  for (const x of [...c.causes, ...c.risks]) {
    if (!x.evidenceIds.length) problems.push(`claim ${x.id} has no evidence`);
    cites(`claim ${x.id}`, x.evidenceIds);
  }
  for (const a of c.actions) {
    if (a.kind !== "open_source" && !a.requiresApproval) problems.push(`action ${a.id}: side effects must require approval`);
    if (a.kind !== "open_source" && !a.draft) problems.push(`action ${a.id}: needs a draft to approve`);
    cites(`action ${a.id}`, a.draft?.evidenceIds);
  }
  if (!answered) {
    if (c.facts.length || c.causes.length || c.risks.length) problems.push("a refusal must not contain claims");
    if (c.evidence.length) problems.push("a refusal must not cite evidence");
  }
  if (c.confidence.level === "high" && c.unknowns.length > 2) problems.push("high confidence with many unknowns");
  return problems;
}
