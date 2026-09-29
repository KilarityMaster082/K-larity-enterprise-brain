// Owner task: EB-95 Answer contract (interim guard) — the validator catches every way a contract can break the
// trust rules: uncited claims, unknown sources, model-made numbers, unapproved side effects, refusals with claims.
import assert from "node:assert/strict";
import { test } from "node:test";

import { answerQuestion } from "@/lib/ask/engine";
import { validateContract } from "@/lib/ask/validate";
import type { AnswerContract } from "@/lib/contracts";
import { STUDIO8_DATA } from "@/lib/data/seed-studio8";

const good = () => structuredClone(answerQuestion("Why is Project Phoenix over budget?", STUDIO8_DATA, { canSeeFinance: true, hasSyncedSource: true }));
const bad = (mutate: (c: AnswerContract) => void): string[] => {
  const c = good();
  mutate(c);
  return validateContract(c);
};

test("engine output passes for every suggested question", () => {
  for (const q of ["Why is Project Phoenix over budget?", "Which client payments are overdue?", "What did we decide about the Phoenix facade?", "What changed on Marigold Clinic recently?", "What is the latest structural drawing for Phoenix?", "Why is Lotus Villa over budget?", "Why is Banyan Office over budget?"]) {
    const c = answerQuestion(q, STUDIO8_DATA, { canSeeFinance: true, hasSyncedSource: true });
    assert.deepEqual(validateContract(c), [], q);
  }
});

test("each broken rule is reported", () => {
  assert.deepEqual(validateContract(good()), []);
  assert.match(bad((c) => (c.facts[0]!.figure!.origin = "model" as never)).join(), /must come from SQL/);
  assert.match(bad((c) => (c.facts[0]!.evidenceIds = [])).join(), /has no evidence/);
  assert.match(bad((c) => (c.causes[0]!.evidenceIds = ["ghost"])).join(), /unknown evidence ghost/);
  assert.match(bad((c) => c.answer.forEach((s) => (s.evidenceIds = undefined))).join(), /no cited statement/);
  assert.match(bad((c) => (c.answer[0]!.evidenceIds = ["ghost"])).join(), /answer\[0\] cites unknown/);
  assert.match(bad((c) => (c.evidence[1]!.highlight = { start: 5, end: 99_999 })).join(), /highlight is outside/);
  assert.match(bad((c) => c.evidence.push({ ...c.evidence[0]! })).join(), /duplicate evidence ids/);
  assert.match(bad((c) => (c.actions[0]!.requiresApproval = false)).join(), /must require approval/);
  assert.match(bad((c) => (c.actions[0]!.draft = undefined)).join(), /needs a draft/);
  assert.match(bad((c) => (c.facts[0]!.figure!.amount = Number.NaN)).join(), /not a number/);
});

test("a refusal must not carry claims or sources", () => {
  const refusal = answerQuestion("What is the Wi-Fi password?", STUDIO8_DATA, { canSeeFinance: true, hasSyncedSource: true });
  assert.deepEqual(validateContract(refusal), []);
  refusal.facts.push({ id: "f", text: "invented", evidenceIds: [] });
  assert.match(validateContract(refusal).join(), /refusal must not contain claims/);
  const refusal2 = answerQuestion("What is the Wi-Fi password?", STUDIO8_DATA, { canSeeFinance: true, hasSyncedSource: true });
  refusal2.evidence.push({ id: "e", sourceType: "email", title: "x", excerpt: "abc", highlight: { start: 0, end: 1 } });
  assert.match(validateContract(refusal2).join(), /refusal must not cite evidence/);
});
