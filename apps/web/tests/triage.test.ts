// Owner task: EB-53 Decision Memory with review UI — triage orders the draft queue and says why; it never decides.
import assert from "node:assert/strict";
import { test } from "node:test";

import { STUDIO8_DATA } from "@/lib/data/seed-studio8";
import type { Decision } from "@/lib/data/types";
import { canReviewDraft, HIGH_IMPACT, LOW_CONFIDENCE, triageDrafts } from "@/lib/triage";

const draft = (over: Partial<Decision>): Decision => ({ decisionId: "d", projectId: "p", title: "t", description: "", status: "proposed", alternatives: [], evidenceIds: ["a", "b"], ...over });

test("only drafts are triaged, and the ones needing a careful look come first", () => {
  const out = triageDrafts([
    draft({ decisionId: "clear", confidence: 0.9 }),
    draft({ decisionId: "low", confidence: LOW_CONFIDENCE - 0.1 }),
    draft({ decisionId: "done", status: "decided" }),
    draft({ decisionId: "big", costImpact: HIGH_IMPACT, confidence: 0.9 }),
    draft({ decisionId: "single", evidenceIds: ["a"], confidence: 0.9 }),
  ]);
  assert.deepEqual(out.map((t) => t.decision.decisionId).sort(), ["big", "clear", "low", "single"]);
  assert.equal(out.at(-1)!.decision.decisionId, "clear");
  assert.equal(out.at(-1)!.needsCare, false);
  assert.ok(out.slice(0, 3).every((t) => t.needsCare && t.reasons.length > 0));
});

test("a role that cannot see finance gets no cost signal: triage on stripped drafts ignores the amount", () => {
  const stripped = STUDIO8_DATA.decisions.filter((d) => d.status === "proposed").map((d) => ({ ...d, costImpact: undefined }));
  for (const t of triageDrafts(stripped)) assert.ok(!t.reasons.some((r) => /cost/i.test(r)));
});

test("the seed drafts are triaged deterministically", () => {
  const ids = triageDrafts(STUDIO8_DATA.decisions).map((t) => t.decision.decisionId);
  assert.deepEqual(ids, triageDrafts([...STUDIO8_DATA.decisions].reverse()).map((t) => t.decision.decisionId));
  assert.ok(ids.includes("dec-phx-rfi27-rate"));
});

test("partners and owners review every draft; a member only on the project they lead", () => {
  assert.ok(canReviewDraft("owner", "Someone", "Me"));
  assert.ok(canReviewDraft("admin", undefined, "Me"));
  assert.ok(canReviewDraft("member", "Me", "Me"));
  assert.ok(!canReviewDraft("member", "Someone else", "Me"));
  assert.ok(!canReviewDraft("member", undefined, "Me"));
  assert.ok(!canReviewDraft("viewer", "Me", "Me"));
  assert.ok(!canReviewDraft("guest", "Me", "Me"));
});
