// Owner task: EB-88 Tenant admin console — dead-letter replay, connector lag, gateway budget and infrastructure health.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { auditLog, listTenants, resetAdminData, setStatus } from "@/lib/data";
import {
  ALERT_THRESHOLD, budgetState, cellHealth, dismissDeadLetter, doclingStats, gatewayRows, infrastructure, listDeadLetters, opensearchHealth, pipelineRows,
  poolHealth, qdrantHealth, queueHealth, replayDeadLetter, resetOpsData, setGatewayBudget, traceUrl, worst,
} from "@/lib/ops";

const studio = () => listTenants().find((t) => t.slug === "studio8")!;
beforeEach(() => {
  resetAdminData();
  resetOpsData();
});

describe("dead-letter queue", () => {
  it("every row belongs to a tenant and mirrors the table's stages", () => {
    const rows = listDeadLetters({ state: "all" });
    assert.ok(rows.length >= 19);
    for (const r of rows) {
      assert.ok(r.tenantId && r.idempotencyKey.startsWith(r.tenantId), "idempotency key is tenant-scoped");
      assert.ok(["sync", "parse", "chunk", "embed", "index", "extract_events", "resolve_entities"].includes(r.stage));
    }
  });
  it("filters by tenant: another tenant sees none of these rows", () => {
    const canary = listTenants().find((t) => t.isSynthetic)!;
    assert.equal(listDeadLetters({ tenantId: canary.tenantId }).length, 0);
    assert.ok(listDeadLetters({ tenantId: studio().tenantId }).length > 0);
  });
  it("replay needs a reason, an active tenant and a source that is not waiting for re-authorisation", () => {
    const parse = listDeadLetters({ stage: "parse" }).find((d) => d.sourceId === "src-drive")!;
    assert.throws(() => replayDeadLetter("Ops", parse.id, "short"), /reason/);
    const gmail = listDeadLetters({ sourceId: "src-gmail-accounts" })[0]!;
    assert.throws(() => replayDeadLetter("Ops", gmail.id, "retrying after the fix"), /re-authorised/);
    const r = replayDeadLetter("Ops", parse.id, "Docling timeout raised to 240 s");
    assert.ok(r.resolvedAt && r.resolvedBy === "Ops");
    assert.throws(() => replayDeadLetter("Ops", parse.id, "second replay attempt"), /already resolved/);
    assert.ok(auditLog().some((a) => a.action === "dlq.replay" && a.tenant === "studio8" && a.reason?.includes("240")));
  });
  it("a suspended tenant's items cannot be replayed", () => {
    setStatus("Ops", studio().tenantId, "suspended", "billing hold pending review");
    const d = listDeadLetters({ stage: "parse" })[0]!;
    assert.throws(() => replayDeadLetter("Ops", d.id, "trying anyway please"), /active tenants/);
  });
  it("dismiss resolves and audits; resolved rows leave the open list", () => {
    const before = listDeadLetters().length;
    const d = listDeadLetters({ stage: "chunk" })[0]!;
    dismissDeadLetter("Ops", d.id, "duplicate of a re-uploaded file");
    assert.equal(listDeadLetters().length, before - 1);
    assert.equal(listDeadLetters({ state: "resolved" }).length, 1);
    assert.ok(auditLog().some((a) => a.action === "dlq.dismiss"));
  });
  it("Docling stats count parser failures only", () => {
    const s = doclingStats();
    assert.equal(s.open, 2); // a timeout and a TableFormer structure error
    assert.equal(s.timeouts, 1);
  });
});

describe("connector lag", () => {
  it("reports the Gmail historyId lag and keeps dead-letter counts live", () => {
    const rows = pipelineRows();
    const partners = rows.find((r) => r.sourceId === "src-gmail-partners")!;
    const accounts = rows.find((r) => r.sourceId === "src-gmail-accounts")!;
    assert.equal(partners.historyLag, 6);
    assert.equal(accounts.historyLag, 28_076);
    assert.equal(accounts.slaMet, false);
    assert.equal(accounts.deadLetters, 14);
    const drive = listDeadLetters({ sourceId: "src-drive", stage: "parse" }).find((d) => d.errorType === "DoclingTimeoutError")!;
    replayDeadLetter("Ops", drive.id, "Docling timeout raised to 240 s");
    assert.equal(pipelineRows().find((r) => r.sourceId === "src-drive")!.deadLetters, 2);
  });
  it("exposes the WhatsApp export queue", () => {
    const wa = pipelineRows().find((r) => r.type === "whatsapp")!;
    assert.deepEqual({ q: wa.whatsapp?.queued, f: wa.whatsapp?.failed }, { q: 4, f: 2 });
    assert.equal(wa.slaMinutes, 5);
  });
});

describe("gateway budget", () => {
  it("$500 cap with an alert at 85 % and a block at the cap", () => {
    assert.equal(ALERT_THRESHOLD, 0.85);
    assert.equal(budgetState(100, 500), "ok");
    assert.equal(budgetState(425, 500), "alert");
    assert.equal(budgetState(499.99, 500), "alert");
    assert.equal(budgetState(500, 500), "blocked");
    assert.equal(budgetState(1, 0), "blocked");
  });
  it("spend per alias adds up to the tenant's spend", () => {
    for (const r of gatewayRows()) {
      const sum = r.byAlias.reduce((a, x) => a + x.costUsd, 0);
      assert.ok(Math.abs(sum - r.spendUsd) < 0.05, `${r.slug}: ${sum} vs ${r.spendUsd}`);
      assert.deepEqual(r.byAlias.map((a) => a.alias), ["fast", "reason", "embed", "rerank"]);
    }
  });
  it("changing a cap needs a reason and a sane amount, and is audited", () => {
    const id = studio().tenantId;
    assert.throws(() => setGatewayBudget("Ops", id, 20, "a long enough reason"), /between/);
    assert.throws(() => setGatewayBudget("Ops", id, 800, "short"), /reason/);
    setGatewayBudget("Ops", id, 800, "pilot extended to Q4 by contract");
    assert.equal(gatewayRows().find((r) => r.slug === "studio8")!.capUsd, 800);
    assert.ok(auditLog().some((a) => a.action === "gateway.set_budget" && a.detail === "$500 → $800"));
  });
  it("links to Langfuse only when the host is configured and well-formed", () => {
    assert.equal(traceUrl("tr_1", undefined), undefined);
    assert.equal(traceUrl("tr_1", "javascript:alert(1)"), undefined);
    assert.equal(traceUrl("tr 1", "https://langfuse.example.in/"), "https://langfuse.example.in/trace/tr%201");
  });
});

describe("infrastructure health", () => {
  it("rolls components up to the worst state", () => {
    assert.equal(worst("ok", "degraded", "ok"), "degraded");
    assert.equal(worst("ok", "failing", "degraded"), "failing");
    assert.equal(worst(), "ok");
  });
  it("classifies pools, nodes, clusters and queues", () => {
    assert.equal(poolHealth({ name: "p", active: 10, idle: 5, max: 50, waiting: 0, p95Ms: 5 }), "ok");
    assert.equal(poolHealth({ name: "p", active: 22, idle: 6, max: 30, waiting: 3, p95Ms: 19 }), "degraded");
    assert.equal(poolHealth({ name: "p", active: 30, idle: 0, max: 30, waiting: 9, p95Ms: 90 }), "failing");
    const n = (up: boolean) => ({ id: "q", up, shards: 1, vectors: 1, diskPct: 0.3 });
    assert.equal(qdrantHealth([n(true), n(true), n(true)]), "ok");
    assert.equal(qdrantHealth([n(true), n(true), n(false)]), "degraded");
    assert.equal(qdrantHealth([n(true), n(false), n(false)]), "failing");
    assert.equal(opensearchHealth({ status: "green", nodes: 3, unassignedShards: 0, heapPct: 0.5 }), "ok");
    assert.equal(opensearchHealth({ status: "yellow", nodes: 3, unassignedShards: 2, heapPct: 0.5 }), "degraded");
    assert.equal(opensearchHealth({ status: "red", nodes: 3, unassignedShards: 9, heapPct: 0.5 }), "failing");
    assert.equal(queueHealth({ name: "q", workers: 4, backlog: 12, scheduleToStartP95Ms: 240 }), "ok");
    assert.equal(queueHealth({ name: "q", workers: 0, backlog: 3, scheduleToStartP95Ms: 0 }), "failing");
  });
  it("the seeded cell is degraded (yellow OpenSearch, busy worker pool)", () => {
    assert.equal(cellHealth(infrastructure()[0]!), "degraded");
  });
});
