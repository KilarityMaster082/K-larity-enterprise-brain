// Owner task: EB-95 Answer contract types generated from the schema — the contracts this app produces are written
// to packages/schemas/answer_contract/fixtures and must equal the committed files. The Python side
// (packages/schemas/tests) validates the same files with the canonical pydantic model, so the TypeScript
// contract and the canonical schema cannot drift apart unnoticed. Regenerate with UPDATE_FIXTURES=1.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";

import { answerQuestion } from "@/lib/ask/engine";
import { validateContract } from "@/lib/ask/validate";
import { eventsFor } from "@/lib/ask/stream";
import { STUDIO8_DATA } from "@/lib/data/seed-studio8";

const DIR = new URL("../../../packages/schemas/answer_contract/fixtures/", import.meta.url);
const NOW = new Date("2026-09-30T06:30:00Z");
const base = { canSeeFinance: true, hasSyncedSource: true, now: NOW };

const CASES: Record<string, { q: string; opts?: Partial<typeof base> }> = {
  phoenix_over_budget: { q: "Why is Project Phoenix over budget?" },
  overdue_payments: { q: "Which client payments are overdue?" },
  facade_decision: { q: "What did we decide about the Phoenix facade?" },
  latest_structural_drawing: { q: "What is the latest structural drawing for Phoenix?" },
  recent_changes: { q: "What changed on Marigold Clinic recently?" },
  finance_denied_for_member: { q: "Why is Project Phoenix over budget?", opts: { canSeeFinance: false } },
  insufficient_evidence: { q: "What is the colour of the moon?" },
  no_synced_source: { q: "Why is Project Phoenix over budget?", opts: { hasSyncedSource: false } },
};

for (const [name, c] of Object.entries(CASES)) {
  test(`fixture ${name}: valid, and identical to the committed file`, () => {
    const contract = answerQuestion(c.q, STUDIO8_DATA, { ...base, ...c.opts });
    assert.deepEqual(validateContract(contract), []);
    const json = JSON.stringify(contract, null, 2) + "\n";
    const file = new URL(`${name}.json`, DIR);
    if (process.env["UPDATE_FIXTURES"] === "1" || !existsSync(file)) {
      mkdirSync(DIR, { recursive: true });
      writeFileSync(file, json);
    }
    assert.equal(readFileSync(file, "utf8"), json, `${name}.json is stale: run UPDATE_FIXTURES=1 pnpm --filter @klarity/web test`);
  });
}

test("a streamed answer ends with the same contract it was built from", () => {
  const contract = answerQuestion(CASES["phoenix_over_budget"]!.q, STUDIO8_DATA, base);
  const events = eventsFor(contract);
  const last = events[events.length - 1]!;
  assert.equal(last.type, "done");
  assert.deepEqual(last.type === "done" ? last.contract : null, contract);
  const firstEvidence = events.findIndex((e) => e.type === "evidence");
  const firstSegment = events.findIndex((e) => e.type === "segment");
  assert.ok(firstEvidence >= 0 && firstEvidence < firstSegment, "evidence is sent before any segment that cites it");
});
