// Owner task: EB-98 UI tests — the dev store: tenant isolation, review rules, audit trail, onboarding.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { connectSource, createApproval, decideApproval, evidenceById, inviteMember, markAskedFirstQuestion, resetStore, reviewDecision, setMemberRole, StoreError, tenantView } from "@/lib/data/store";
import { CANARY } from "@/lib/data/seed-synthetic";

const S8 = ["0fdc5142-8c25-41c5-aab4-0a88db52a5bf", "studio8"] as const;
const CAN = ["1bae9ff8-abf9-44bf-9b17-a5cb2c83d71b", "synthetic-canary"] as const;

beforeEach(() => resetStore());

test("tenants see only their own data, in both directions", () => {
  const s8 = JSON.stringify(tenantView(...S8).data);
  assert.ok(!s8.includes(CANARY));
  const can = tenantView(...CAN, Date.now() + 60_000); // canary tenant hidden until synced
  assert.equal(can.data.projects.length, 0);
  connectSource(...CAN, "Tester", "gmail", "canary@example.com");
  const later = tenantView(...CAN, Date.now() + 20_000);
  assert.ok(JSON.stringify(later.data).includes(CANARY));
  assert.ok(!JSON.stringify(later.data).includes("Phoenix"));
  assert.ok(!JSON.stringify(tenantView(...S8).audit).includes("canary@example.com"), "audit is per tenant");
});

test("unknown tenants get an empty, gated workspace", () => {
  const v = tenantView("aaaaaaaa-0000-0000-0000-000000000000", "someone-else");
  assert.equal(v.data.projects.length, 0);
  assert.equal(v.hasSyncedSource, false);
});

test("evidence lookup returns only this tenant's evidence", () => {
  const v = tenantView(...S8);
  assert.equal(evidenceById(v, ["ev-phx-vo07", "ev-canary-1"]).length, 1);
});

test("onboarding: connect → first sync takes time → ask a question", () => {
  const t0 = Date.now();
  let v = tenantView(...CAN, t0);
  assert.deepEqual([v.onboarding.connected, v.onboarding.synced, v.onboarding.done], [false, false, false]);
  connectSource(...CAN, "Tester", "gmail", "canary@example.com");
  v = tenantView(...CAN, Date.now() + 100);
  assert.equal(v.onboarding.connected, true);
  assert.equal(v.onboarding.synced, false);
  assert.ok(v.syncProgress! > 0 && v.syncProgress! < 1);
  v = tenantView(...CAN, Date.now() + 13_000);
  assert.equal(v.onboarding.synced, true);
  assert.equal(v.onboarding.done, false);
  markAskedFirstQuestion(...CAN);
  assert.equal(tenantView(...CAN, Date.now() + 13_000).onboarding.done, true);
});

test("reviewing a decision: confirm, edit, reject — once, with an audit event", () => {
  const before = tenantView(...S8).audit.length;
  const d = reviewDecision(...S8, "Reviewer", "dec-mc-pvc", "confirm");
  assert.equal(d.status, "decided");
  assert.equal(d.reviewedBy, "Reviewer");
  assert.throws(() => reviewDecision(...S8, "Reviewer", "dec-mc-pvc", "confirm"), StoreError, "cannot review twice");
  assert.throws(() => reviewDecision(...S8, "Reviewer", "dec-phx-facade", "reject"), StoreError, "only drafts");
  assert.throws(() => reviewDecision(...S8, "Reviewer", "dec-phx-crews", "edit", { title: " ", description: "x" }), StoreError, "edit needs content");
  const e = reviewDecision(...S8, "Reviewer", "dec-phx-crews", "edit", { title: "Keep crews on site for 3 weeks", description: "Agreed with the site engineer." });
  assert.equal(e.title, "Keep crews on site for 3 weeks");
  const r = reviewDecision(...S8, "Reviewer", "dec-bo-handover", "reject", { note: "Only a suggestion" });
  assert.equal(r.status, "revoked");
  assert.equal(tenantView(...S8).audit.length, before + 3);
  assert.throws(() => reviewDecision(...CAN, "Reviewer", "dec-bo-handover", "confirm"), StoreError, "another tenant's decision id does not resolve");
});

test("approvals: reject needs a reason, decisions are final, duplicates collapse", () => {
  const a = createApproval(...S8, "Ask Brain user", { kind: "draft_message", title: "Remind X", body: "Body", reason: "Overdue", evidenceIds: ["ev-mc-reminder"] });
  const again = createApproval(...S8, "Ask Brain user", { kind: "draft_message", title: "Remind X", body: "Body", reason: "Overdue", evidenceIds: [] });
  assert.equal(again.approvalId, a.approvalId, "same pending request is not duplicated");
  assert.throws(() => decideApproval(...S8, "Partner", a.approvalId, "reject", " "), StoreError);
  const ok = decideApproval(...S8, "Partner", a.approvalId, "approve", "", "Edited body");
  assert.equal(ok.status, "approved");
  assert.equal(ok.body, "Edited body");
  assert.throws(() => decideApproval(...S8, "Partner", a.approvalId, "reject", "changed my mind"), StoreError, "already decided");
  assert.throws(() => decideApproval(...CAN, "Partner", a.approvalId, "approve", ""), StoreError, "not visible to another tenant");
});

test("members: last owner is protected, invites are validated", () => {
  assert.throws(() => setMemberRole(...S8, "Owner", "u-principal", "member"), StoreError, "last owner");
  assert.equal(setMemberRole(...S8, "Owner", "u-lead-phx", "viewer").role, "viewer");
  assert.throws(() => inviteMember(...S8, "Owner", "not-an-email", "member"), StoreError);
  assert.throws(() => inviteMember(...S8, "Owner", "principal@studio8.example", "member"), StoreError, "already a member");
  assert.equal(inviteMember(...S8, "Owner", "New.Person@Example.com", "guest").email, "new.person@example.com");
});
