// Owner task: EB-98 UI tests — the role matrix and navigation stay in step.
import assert from "node:assert/strict";
import { test } from "node:test";

import { navFor, NAV } from "@/lib/nav";
import { can, ROLES } from "@/lib/permissions";

test("owners can do everything; admins everything except managing members", () => {
  assert.ok(can("owner", "members.manage"));
  assert.ok(!can("admin", "members.manage"));
  for (const cap of ["finance.view", "executive.view", "approvals.decide", "sources.manage", "settings.view"] as const) {
    assert.ok(can("owner", cap) && can("admin", cap), cap);
  }
});

test("members, viewers and guests never see finance, executive, settings or can decide approvals", () => {
  for (const role of ["member", "viewer", "guest"] as const) {
    for (const cap of ["finance.view", "executive.view", "settings.view", "approvals.decide", "sources.manage", "members.manage"] as const) {
      assert.ok(!can(role, cap), `${role} must not have ${cap}`);
    }
  }
});

test("guests can only ask and read documents; viewers cannot review decisions", () => {
  assert.deepEqual(navFor("guest").map((i) => i.href), ["/ask", "/documents"]);
  assert.ok(!can("viewer", "decisions.review"));
  assert.ok(can("member", "decisions.review"));
});

test("navigation is derived from capabilities for every role", () => {
  for (const role of ROLES) {
    for (const item of NAV) assert.equal(navFor(role).includes(item), can(role, item.cap), `${role} ${item.href}`);
  }
});
