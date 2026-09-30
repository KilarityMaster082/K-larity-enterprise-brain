// Owner task: EB-98 UI tests — the answer engine follows the trust rules: cited claims, figures from the ledger,
// role limits, honest "not enough evidence", and nothing across tenants.
import assert from "node:assert/strict";
import { test } from "node:test";

import { answerQuestion } from "@/lib/ask/engine";
import { validateContract } from "@/lib/ask/validate";
import { projectFinance } from "@/lib/data/derive";
import { SYNTHETIC_DATA, CANARY } from "@/lib/data/seed-synthetic";
import { STUDIO8_DATA } from "@/lib/data/seed-studio8";

const opts = { canSeeFinance: true, hasSyncedSource: true };
const ask = (q: string, o = opts, ds = STUDIO8_DATA) => answerQuestion(q, ds, o);

test("Phoenix over-budget answer matches the ledger and cites every claim", () => {
  const a = ask("Why is Project Phoenix over budget?");
  const fin = projectFinance(STUDIO8_DATA, "phoenix");
  assert.equal(a.status, "answered");
  assert.equal(a.facts.find((f) => f.id === "f-total")!.figure!.amount, fin.overrun);
  assert.deepEqual(validateContract(a), []);
  assert.ok(a.facts.every((f) => f.figure!.origin === "sql"));
  assert.ok(a.risks.some((r) => r.severity === "high"), "unsigned VO-07 is a high risk");
  assert.ok(a.actions.every((x) => x.kind === "open_source" || (x.requiresApproval && x.draft)), "side effects need approval");
  assert.ok(a.unknowns.length > 0);
});

test("the figures in the answer sum to the total (no invented numbers)", () => {
  const a = ask("Why is Project Phoenix over budget?");
  const parts = a.facts.filter((f) => f.id !== "f-total").reduce((s, f) => s + f.figure!.amount, 0);
  assert.equal(parts, a.facts.find((f) => f.id === "f-total")!.figure!.amount);
});

test("the ledger query result is itself a citable source", () => {
  const a = ask("Why is Project Phoenix over budget?");
  const ledger = a.evidence.find((e) => e.sourceType === "sql")!;
  assert.ok(ledger.excerpt.includes("18,40,000"));
  assert.equal(ledger.excerpt.slice(ledger.highlight!.start, ledger.highlight!.end), "Over budget ₹18,40,000 (12%)");
});

test("overdue payments are listed with days late and a reminder draft per invoice", () => {
  const a = ask("Which client payments are overdue?");
  assert.equal(a.facts.find((f) => f.id === "f-total")!.figure!.amount, 4_000_000);
  assert.equal(a.actions.length, 2);
  assert.ok(a.actions.every((x) => x.draft!.evidenceIds.length > 0));
  assert.deepEqual(validateContract(a), []);
});

test("decisions: answers from a confirmed decision and mentions what it replaced", () => {
  const a = ask("What did we decide about the Lotus Villa marble flooring?");
  const text = a.answer.map((s) => s.text).join("");
  assert.match(text, /Makrana/);
  assert.match(text, /replaced an earlier choice/);
  assert.equal(a.confidence.level, "high");
});

test("a draft decision is reported as unconfirmed", () => {
  const a = ask("What was decided about the Marigold OT flooring PVC?");
  assert.match(a.answer.map((s) => s.text).join(""), /no confirmed decision/i);
  assert.equal(a.confidence.level, "medium");
});

test("latest drawing answer names the newest revision", () => {
  const a = ask("What is the latest structural drawing for Phoenix?");
  assert.match(a.answer.map((s) => s.text).join(""), /PHX-STR-204.*Rev C/);
});

test("unanswerable questions refuse to guess", () => {
  const a = ask("What is our office Wi-Fi password?");
  assert.equal(a.status, "insufficient_evidence");
  assert.equal(a.facts.length, 0);
  assert.equal(a.evidence.length, 0);
  assert.equal(a.confidence.level, "low");
});

test("finance questions are refused for roles without finance access", () => {
  for (const q of ["Why is Project Phoenix over budget?", "Which client payments are overdue?"]) {
    const a = ask(q, { ...opts, canSeeFinance: false });
    assert.equal(a.status, "no_access", q);
    assert.equal(a.facts.length, 0);
    assert.equal(a.evidence.length, 0);
  }
});

test("a workspace with no synced source cannot answer", () => {
  const a = ask("Why is Project Phoenix over budget?", { ...opts, hasSyncedSource: false });
  assert.equal(a.status, "insufficient_evidence");
  assert.match(a.unknowns.join(" "), /Settings/);
});

test("tenant isolation: the other tenant's data never reaches this tenant's answers, and vice versa", () => {
  const studio = JSON.stringify([ask("Which client payments are overdue?"), ask("What changed recently?"), ask("Why is Project Phoenix over budget?")]);
  assert.ok(!studio.includes(CANARY), "no canary in Studio 8 answers");
  const canary = ask("Why is Project Phoenix over budget?", opts, SYNTHETIC_DATA);
  assert.ok(!JSON.stringify(canary).includes("Phoenix client"), "Studio 8 data absent from the canary tenant");
  assert.equal(canary.status, "insufficient_evidence");
});

test("a scoped question stays inside its project", () => {
  const a = ask("what changed?", opts);
  const scoped = answerQuestion("what changed?", STUDIO8_DATA, { ...opts, projectId: "marigold" });
  const scopedText = scoped.answer.map((s) => s.text).join("");
  assert.ok(!/Phoenix/.test(scopedText));
  assert.ok(scoped.evidence.every((e) => !e.project || e.project === "Marigold Clinic"));
  assert.ok(a.evidence.length >= scoped.evidence.length);
});

test("a draft confirmed in review is attributed to the reviewer, not to an invented decider", async () => {
  const { resetStore, reviewDecision, tenantView } = await import("@/lib/data/store");
  resetStore();
  const S8 = ["0fdc5142-8c25-41c5-aab4-0a88db52a5bf", "studio8"] as const;
  reviewDecision(...S8, "Project lead", "dec-mc-pvc", "confirm");
  const a = answerQuestion("What was decided about the Marigold OT flooring PVC?", tenantView(...S8).data, opts);
  const text = a.answer.map((s) => s.text).join("");
  assert.match(text, /Confirmed by Project lead: Seamless coved PVC/);
  assert.equal(a.confidence.level, "high");
  resetStore();
});
