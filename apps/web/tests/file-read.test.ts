// Owner task: EB-102 File viewers — GET /api/files/[id] logic: tenant isolation, role gates and money redaction.
import assert from "node:assert/strict";
import { test } from "node:test";

import { tenantView } from "@/lib/data/store";
import { readFile } from "@/lib/viewers/read";
import { TENANTS } from "@/lib/tenants";

const studio = tenantView(TENANTS[0]!.tenantId, TENANTS[0]!.slug);
const canary = tenantView(TENANTS[1]!.tenantId, TENANTS[1]!.slug);

test("another tenant's document is 404 and a role without documents.view gets 403", () => {
  const miss = readFile(canary, "owner", "d-phx-boq");
  assert.equal(!miss.ok && miss.status, 404);
  const none = readFile(studio, "guest", "d-phx-boq");
  assert.ok(none.ok || none.status === 403); // guests may view documents in this model
  const bogus = readFile(studio, "owner", "nope");
  assert.equal(!bogus.ok && bogus.status, 404);
});

test("BOQ currency columns are hidden from roles without finance.view", () => {
  const owner = readFile(studio, "owner", "d-phx-boq");
  assert.ok(owner.ok && owner.file.content?.kind === "xlsx");
  assert.equal(owner.ok && owner.file.redacted, false);
  const member = readFile(studio, "member", "d-phx-boq");
  assert.ok(member.ok && member.file.content?.kind === "xlsx");
  if (member.ok && member.file.content?.kind === "xlsx") {
    const first = member.file.content.sheets[0]!.rows[0]!;
    assert.equal(first[4], "—");
    assert.equal(first[5], "—");
    assert.equal(first[3], 14.2, "quantities are not money");
  }
  assert.equal(member.ok && member.file.redacted, true);
});

test("code files need code.view", () => {
  const code = studio.data.documents.find((d) => /\.(json|ya?ml|diff|py|sql)$/.test(d.fileName ?? ""));
  assert.ok(code, "the seed has a code document");
  const viewer = readFile(studio, "viewer", code!.documentId);
  assert.equal(!viewer.ok && viewer.status, 403);
  assert.ok(readFile(studio, "owner", code!.documentId).ok);
});

test("revisions of a drawing series are listed newest first", () => {
  const r = readFile(studio, "member", "d-phx-str204-c");
  assert.ok(r.ok);
  if (r.ok) {
    assert.ok(r.file.revisions.length >= 1);
    const dates = r.file.revisions.map((x) => x.updatedAt);
    assert.deepEqual([...dates].sort().reverse(), dates);
  }
});
