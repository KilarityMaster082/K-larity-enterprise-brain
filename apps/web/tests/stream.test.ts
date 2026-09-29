// Owner task: EB-98 UI tests — the streaming protocol: evidence first, and no claim shown before its evidence.
import assert from "node:assert/strict";
import { test } from "node:test";

import { answerQuestion } from "@/lib/ask/engine";
import { apply, EMPTY_PARTIAL, eventsFor } from "@/lib/ask/stream";
import { STUDIO8_DATA } from "@/lib/data/seed-studio8";

const contract = answerQuestion("Why is Project Phoenix over budget?", STUDIO8_DATA, { canSeeFinance: true, hasSyncedSource: true });

test("evidence is always sent before anything that cites it", () => {
  const seen = new Set<string>();
  for (const e of eventsFor(contract)) {
    if (e.type === "evidence") e.evidence.forEach((x) => seen.add(x.id));
    const cites =
      e.type === "segment" ? e.segment.evidenceIds ?? [] : e.type === "facts" ? e.facts.flatMap((c) => c.evidenceIds) : e.type === "causes" ? e.causes.flatMap((c) => c.evidenceIds) : e.type === "risks" ? e.risks.flatMap((c) => c.evidenceIds) : [];
    for (const id of cites) assert.ok(seen.has(id), `${e.type} cites ${id} before it was sent`);
  }
  assert.equal(eventsFor(contract).at(-1)!.type, "done");
});

test("folding the events rebuilds the same answer", () => {
  let p = EMPTY_PARTIAL;
  for (const e of eventsFor(contract)) p = apply(p, e);
  assert.deepEqual(p.answer, contract.answer);
  assert.deepEqual(p.facts, contract.facts);
  assert.deepEqual(p.risks, contract.risks);
  assert.equal(p.evidence.length, contract.evidence.length);
});

test("a segment whose evidence has not arrived is never shown", () => {
  const p = apply(EMPTY_PARTIAL, { type: "segment", segment: { text: "Unsupported claim.", evidenceIds: ["nope"] } });
  assert.equal(p.answer.length, 0);
  const q = apply(EMPTY_PARTIAL, { type: "facts", facts: [{ id: "f", text: "x", evidenceIds: ["nope"] }] });
  assert.equal(q.facts.length, 0);
});

test("a stream cut off midway leaves only checked claims", () => {
  const events = eventsFor(contract);
  const cut = events.slice(0, Math.floor(events.length / 2));
  let p = EMPTY_PARTIAL;
  for (const e of cut) p = apply(p, e);
  const known = new Set(p.evidence.map((e) => e.id));
  for (const s of p.answer) for (const id of s.evidenceIds ?? []) assert.ok(known.has(id));
});
