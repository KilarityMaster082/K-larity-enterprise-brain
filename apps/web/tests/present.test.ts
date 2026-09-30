// Owner task: EB-50 Ask Brain UI — the bento layout picks and orders what the contract carries; it never adds a number.
import assert from "node:assert/strict";
import { test } from "node:test";

import { answerQuestion } from "@/lib/ask/engine";
import { chipLabel, citationStats, citedFor, figureRows, leadFigure } from "@/lib/ask/present";
import { STUDIO8_DATA } from "@/lib/data/seed-studio8";

const answer = answerQuestion("Why is Project Phoenix over budget?", STUDIO8_DATA, { canSeeFinance: true, hasSyncedSource: true, now: new Date("2026-09-30T06:30:00Z") });

test("the headline figure is the SQL total and the rows are the other SQL figures, largest first", () => {
  const lead = leadFigure(answer)!;
  assert.equal(lead.id, "f-total");
  assert.equal(lead.figure!.origin, "sql");
  const rows = figureRows(answer);
  assert.ok(rows.length >= 2);
  assert.ok(rows.every((r, i) => i === 0 || rows[i - 1]!.amount >= r.amount));
  assert.equal(rows[0]!.pct, 100);
  assert.equal(rows.reduce((a, r) => a + r.amount, 0), lead.figure!.amount, "the rows add up to the headline: no invented number");
});

test("every claim is cited and the stats say so", () => {
  const s = citationStats(answer);
  assert.equal(s.cited, s.claims);
  assert.equal(s.sources, answer.evidence.length);
});

test("chips are E1, E2… in source order and map back to what they support", () => {
  assert.equal(chipLabel(answer, answer.evidence[0]!.id), "E1");
  assert.equal(chipLabel(answer, answer.evidence[2]!.id), "E3");
  assert.equal(chipLabel(answer, "nope"), undefined);
  const supports = citedFor(answer, answer.evidence[0]!.id);
  assert.ok(supports.length > 0);
});

test("a refusal has no headline figure", () => {
  const refused = answerQuestion("Why is Project Phoenix over budget?", STUDIO8_DATA, { canSeeFinance: false, hasSyncedSource: true });
  assert.equal(leadFigure(refused), undefined);
  assert.deepEqual(figureRows(refused), []);
});
