// Owner task: EB-98 UI tests — ledger derivations: the numbers every page shows. Phoenix must equal the
// figures in the design spec (₹18.4 lakh over ₹1.53 crore = 12%), and every figure must be re-derivable.
import assert from "node:assert/strict";
import { test } from "node:test";

import { STUDIO8_DATA } from "@/lib/data/seed-studio8";
import { ageing, attentionList, executiveSummary, leakageFlags, openReceivables, payablesDue, portfolio, projectFinance, projectHealth } from "@/lib/data/derive";

const ds = STUDIO8_DATA;

test("Phoenix: budget, forecast and overrun by package", () => {
  const f = projectFinance(ds, "phoenix");
  assert.equal(f.budget, 15_300_000);
  assert.equal(f.overrun, 1_840_000);
  assert.equal(f.forecast, 17_140_000);
  assert.equal(Math.round(f.overrunPct * 1000) / 10, 12);
  const over = Object.fromEntries(f.lines.filter((l) => l.overrun).map((l) => [l.package, l.overrun]));
  assert.deepEqual(over, { Facade: 920_000, "Structural steel": 610_000, "Site labour": 310_000 });
  assert.equal(f.lines.reduce((a, l) => a + l.budget, 0), f.budget, "package budgets add up to the project budget");
});

test("every project's package budgets sum to its approved budget", () => {
  for (const p of ds.projects) {
    assert.equal(ds.budgetLines.filter((b) => b.projectId === p.projectId).reduce((a, b) => a + b.budget, 0), p.budget, p.name);
  }
});

test("billing: Phoenix collected vs outstanding", () => {
  const f = projectFinance(ds, "phoenix");
  assert.equal(f.billed, 12_300_000);
  assert.equal(f.collected, 8_500_000);
  assert.equal(f.outstanding, 3_800_000);
  assert.equal(f.overdue, 0);
});

test("receivables ageing uses the fixed demo date and buckets add up", () => {
  const open = openReceivables(ds);
  const late = open.filter((r) => r.daysOverdue > 0).map((r) => [r.txnRef, r.daysOverdue]);
  assert.deepEqual(late, [["S8/BO/FINAL", 33], ["S8/MC/RA-2", 25]]);
  const a = ageing(ds);
  assert.equal(a.reduce((x, b) => x + b.amount, 0), open.reduce((x, r) => x + r.amount, 0));
  // Aged by invoice date: RA-3 (10 d), DES-2 (5 d) are 0–30; RA-2 (40 d) and the Banyan final bill (48 d) are 31–60.
  assert.equal(a.find((b) => b.bucket === "0–30 d")!.amount, 4_600_000);
  assert.equal(a.find((b) => b.bucket === "31–60 d")!.amount, 4_000_000);
  assert.equal(a.find((b) => b.bucket === "61–90 d")!.amount, 0);
  assert.equal(a.find((b) => b.bucket === "90+ d")!.amount, 0);
});

test("payables due in 30 days are pending and sorted by due date", () => {
  const due = payablesDue(ds, 30);
  assert.ok(due.length > 0);
  assert.ok(due.every((t) => t.status === "pending" && t.direction === "payable"));
  assert.deepEqual(due.map((t) => t.dueDate), [...due.map((t) => t.dueDate)].sort());
});

test("leakage: unsigned variation, unbilled change order and a duplicate invoice are found", () => {
  const kinds = leakageFlags(ds).map((f) => `${f.kind}:${f.amount}`).sort();
  assert.deepEqual(kinds, ["cost_not_billed:610000", "duplicate_invoice:240000", "unsigned_variation:920000"]);
  for (const f of leakageFlags(ds)) assert.ok(f.evidenceIds.length > 0, `${f.id} cites evidence`);
});

test("health: Phoenix off track, Marigold and Banyan at risk, Lotus on track", () => {
  const h = Object.fromEntries(ds.projects.map((p) => [p.projectId, projectHealth(ds, p).health]));
  assert.deepEqual(h, { phoenix: "off_track", marigold: "at_risk", lotus: "on_track", banyan: "at_risk" });
});

test("executive summary agrees with the underlying rows", () => {
  const s = executiveSummary(ds);
  const rows = portfolio(ds);
  assert.equal(s.forecastOverrun, rows.reduce((a, r) => a + r.finance.overrun, 0));
  assert.equal(s.overdue, 4_000_000);
  assert.equal(s.projectsOffTrack + s.projectsAtRisk, 3);
  assert.equal(s.decisionsWaiting, ds.decisions.filter((d) => d.status === "proposed").length);
});

test("attention list is ordered by priority and every item points somewhere", () => {
  const items = attentionList(ds);
  assert.ok(items.length >= 6);
  assert.deepEqual(items.map((i) => i.priority), [...items.map((i) => i.priority)].sort());
  for (const i of items) assert.ok(i.href.startsWith("/"), i.id);
});

test("every ledger row has evidence that quotes its own amount", () => {
  const byId = new Map(ds.evidence.map((e) => [e.id, e]));
  for (const t of ds.txns) {
    const e = byId.get(t.evidenceId);
    assert.ok(e, `${t.txnId} has evidence`);
    const quoted = e.excerpt.slice(e.highlight!.start, e.highlight!.end);
    assert.ok(quoted.includes(new Intl.NumberFormat("en-IN").format(t.amount)), `${t.txnId}: “${quoted}” shows the amount`);
  }
});

test("every event, document and decision cites evidence that exists", () => {
  const ids = new Set(ds.evidence.map((e) => e.id));
  for (const e of ds.events) if (e.evidenceId) assert.ok(ids.has(e.evidenceId), e.eventId);
  for (const d of ds.documents) assert.ok(ids.has(d.evidenceId), d.documentId);
  for (const d of ds.decisions) for (const id of d.evidenceIds) assert.ok(ids.has(id), `${d.decisionId} → ${id}`);
  for (const a of ds.approvals) for (const id of a.evidenceIds) assert.ok(ids.has(id), `${a.approvalId} → ${id}`);
});

test("an under-budget package never offsets another package's overrun", () => {
  // Marigold: civil is ₹2 lakh under budget, MEP is ₹2 lakh over. The overrun is ₹2 lakh, not zero.
  const f = projectFinance(ds, "marigold");
  assert.equal(f.lines.find((l) => l.package === "Civil & partitions")!.overrun, 0);
  assert.equal(f.overrun, 200_000);
  assert.equal(f.forecast, 9_400_000);
  assert.equal(projectFinance(ds, "lotus").overrun, 0);
});

test("cancelled ledger rows are ignored everywhere", () => {
  const cloned = structuredClone(ds);
  const before = projectFinance(cloned, "phoenix");
  cloned.txns.push({ txnId: "x-cancelled", projectId: "phoenix", txnType: "invoice", txnRef: "CANCELLED-1", amount: 5_000_000, direction: "payable", package: "Facade", status: "cancelled", counterparty: "Nobody", txnDate: "2026-09-01", evidenceId: "ev-phx-budget" });
  cloned.txns.push({ txnId: "x-cancelled-r", projectId: "phoenix", txnType: "invoice", txnRef: "CANCELLED-2", amount: 7_000_000, direction: "receivable", status: "cancelled", counterparty: "Nobody", txnDate: "2026-09-01", evidenceId: "ev-phx-budget" });
  assert.deepEqual(projectFinance(cloned, "phoenix"), before);
  assert.equal(openReceivables(cloned).length, openReceivables(ds).length);
});

test("no demo timestamp reads as future: freshness, activity, events and documents are all in the past", () => {
  const now = Date.now();
  const past = (iso: string | undefined, what: string) => iso === undefined || assert.ok(new Date(iso).getTime() <= now, `${what} is in the future: ${iso}`);
  for (const s of ds.sources) past(s.lastSyncAt, `source ${s.sourceId}`);
  for (const m of ds.members) past(m.lastActiveAt, `member ${m.userId}`);
  for (const e of ds.events) past(e.occurredAt, `event ${e.eventId}`);
  for (const d of ds.documents) past(d.updatedAt, `document ${d.documentId}`);
});
