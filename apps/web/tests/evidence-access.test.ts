// Owner task: EB-42 Permission filter — evidence is re-checked against tenant and role before it is rendered.
import assert from "node:assert/strict";
import { test } from "node:test";

import { readEvidence } from "@/lib/evidence-access";
import { tenantView } from "@/lib/data/store";
import { ROLES } from "@/lib/permissions";
import { TENANTS } from "@/lib/tenants";

const studio = TENANTS[0]!;
const canary = TENANTS[1]!;

test("finance evidence is owner and partner only; everything else follows the ask capability", () => {
  const view = tenantView(studio.tenantId, studio.slug);
  const ledger = view.data.txns[0]!.evidenceId;
  for (const role of ROLES) {
    const finance = readEvidence(view, role, ledger);
    assert.equal(finance.ok, role === "owner" || role === "admin", `${role} on ${ledger}`);
    if (!finance.ok) assert.equal(finance.status, 403);
  }
  assert.ok(readEvidence(view, "member", "ev-phx-fac301").ok, "a drawing is not finance evidence");
  assert.ok(readEvidence(view, "guest", "ev-phx-fac301").ok);
});

test("evidence of another tenant is indistinguishable from evidence that does not exist", () => {
  const studioView = tenantView(studio.tenantId, studio.slug);
  const canaryView = tenantView(canary.tenantId, canary.slug);
  assert.equal(readEvidence(studioView, "owner", "ev-canary-1").ok, false);
  const miss = readEvidence(studioView, "owner", "ev-canary-1");
  assert.equal(!miss.ok && miss.status, 404);
  // The canary workspace has not synced a source yet, so even its own evidence stays hidden.
  assert.equal(readEvidence(canaryView, "owner", "ev-canary-1").ok, false);
});

test("locator data survives the read (page, bounding box, table range)", () => {
  const view = tenantView(studio.tenantId, studio.slug);
  const r = readEvidence(view, "owner", "ev-phx-facade-quote");
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.evidence.locator?.parser, "docling");
    assert.ok(r.evidence.locator?.bbox && r.evidence.locator.bbox.x1 > r.evidence.locator.bbox.x0);
    assert.equal(r.evidence.locator?.table?.tableId, "t1");
  }
});
