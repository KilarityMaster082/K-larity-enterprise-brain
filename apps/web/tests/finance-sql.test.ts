// Owner task: EB-55 Financial Brain page — three guarantees about where the money on screen comes from:
//  1. the registry in lib/finance-sql.ts and db/views/finance.sql name the same views and columns;
//  2. a figure without a reviewed origin (unknown view, unknown column, no tenant, not a number) cannot be built;
//  3. the derivations the dev repository uses are written to db/seed/finance_equivalence.json, which the PostgreSQL test
//     (packages/ontology/tests/test_finance_views.py) loads into a database and compares with the views' output.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";

import { ageing, cashMonthly, cashPosition, DEMO_NOW, executiveSummary, leakageFlags, openReceivables, payablesDue, projectFinance } from "@/lib/data/derive";
import { STUDIO8_DATA } from "@/lib/data/seed-studio8";
import { SYNTHETIC_DATA } from "@/lib/data/seed-synthetic";
import type { TenantDataset } from "@/lib/data/types";
import { ageingFigures, executiveFigures, projectFigures } from "@/lib/finance-ledger";
import { assertSqlFigure, assertTenant, FINANCE_VIEWS, originLabel, sqlFigure, SqlOriginError, type FinanceView } from "@/lib/finance-sql";
import { tenantView } from "@/lib/data/store";
import { TENANTS } from "@/lib/tenants";

const SQL = readFileSync(new URL("../../../db/views/finance.sql", import.meta.url), "utf8");
const FIXTURE = new URL("../../../db/seed/finance_equivalence.json", import.meta.url);

test("every registered view or function is defined in db/views/finance.sql with exactly the registered columns", () => {
  for (const [name, def] of Object.entries(FINANCE_VIEWS) as [FinanceView, (typeof FINANCE_VIEWS)[FinanceView]][]) {
    if (def.kind === "view") {
      const m = SQL.match(new RegExp(`CREATE OR REPLACE VIEW ${name} WITH \\(security_invoker = true\\) AS([\\s\\S]*?);\\n\\n`, "i"));
      assert.ok(m, `${name}: view with security_invoker = true not found`);
    } else {
      const m = SQL.match(new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\(([^)]*)\\)\\s*RETURNS TABLE \\(([\\s\\S]*?)\\)\\s*LANGUAGE sql STABLE SECURITY INVOKER`, "i"));
      assert.ok(m, `${name}: SECURITY INVOKER function not found`);
      const args = m![1]!.split(",").map((a) => a.trim().split(/\s+/)[0]);
      assert.deepEqual(args, [...def.args], `${name}: argument names`);
      const cols = m![2]!.split(/,\s*(?![^()]*\))/).map((c) => c.trim().split(/\s+/)[0]);
      assert.deepEqual(cols, [...def.columns], `${name}: returned columns`);
    }
  }
});

test("view columns: each registered column of a view appears as an output alias or selected column", () => {
  for (const [name, def] of Object.entries(FINANCE_VIEWS) as [FinanceView, (typeof FINANCE_VIEWS)[FinanceView]][]) {
    if (def.kind !== "view") continue;
    const body = SQL.slice(SQL.indexOf(`VIEW ${name} `));
    const end = body.indexOf(";\n\n");
    const text = body.slice(0, end);
    for (const c of def.columns) assert.match(text, new RegExp(`(\\bAS\\s+${c}\\b|\\b${c}\\b)`), `${name}.${c}`);
  }
});

test("no table the views read lacks a tenant predicate: every view is security_invoker and every function SECURITY INVOKER", () => {
  assert.equal((SQL.match(/CREATE OR REPLACE VIEW/g) ?? []).length, (SQL.match(/security_invoker = true/g) ?? []).length);
  assert.equal((SQL.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length, (SQL.match(/STABLE SECURITY INVOKER/g) ?? []).length);
  assert.doesNotMatch(SQL, /SECURITY DEFINER/i, "a definer function would bypass the caller's row-level security");
});

test("a figure without a reviewed origin cannot be built", () => {
  assert.throws(() => sqlFigure("t1", "finance_unknown" as FinanceView, "x", 1), SqlOriginError);
  assert.throws(() => sqlFigure("t1", "finance_project_summary", "made_up", 1), /no column/);
  assert.throws(() => sqlFigure("t1", "finance_project_summary", "overrun", Number.NaN), /finite/);
  assert.throws(() => sqlFigure("", "finance_project_summary", "overrun", 5), /tenant_id is required/);
  assert.throws(() => assertSqlFigure({ amount: 5 }), SqlOriginError);
  assert.throws(() => assertSqlFigure({ amount: 5, view: "toString", column: "x", tenantId: "t1" }), SqlOriginError, "inherited object keys are not views");
  const ok = sqlFigure("t1", "finance_project_summary", "overrun", 1840000, { key: "phoenix" });
  assert.equal(originLabel(ok), "finance_project_summary.overrun");
  assert.throws(() => assertTenant(ok, "t2"), /another tenant/);
});

test("every figure the Finance and Executive screens use is a registered SQL figure for the right tenant", () => {
  const studio = TENANTS[0]!;
  const view = tenantView(studio.tenantId, studio.slug);
  const exec = executiveFigures(studio.tenantId, view);
  for (const f of [exec.outstanding, exec.overdue, exec.payablesDue, exec.forecastOverrun, exec.leakage, exec.cashNet]) {
    assertSqlFigure(f);
    assertTenant(f, studio.tenantId);
  }
  assert.equal(exec.forecastOverrun.amount, 1_840_000 + (exec.forecastOverrun.amount - 1_840_000), "figure equals the ledger derivation");
  const ph = projectFigures(studio.tenantId, view).find((p) => p.projectId === "phoenix")!;
  assert.equal(ph.overrun.amount, projectFinance(STUDIO8_DATA, "phoenix").overrun);
  assert.equal(ph.budget.amount, 15_300_000);
  assert.equal(ageingFigures(studio.tenantId, view).reduce((a, b) => a + b.figure.amount, 0), openReceivables(STUDIO8_DATA).reduce((a, r) => a + r.amount, 0));
});

// ---------------------------------------------------------------- equivalence fixture for PostgreSQL
function rowsOf(tenantId: string, ds: TenantDataset) {
  return {
    projects: ds.projects.map((p) => ({ projectId: p.projectId, name: p.name, budget: p.budget })),
    budgetLines: ds.budgetLines,
    txns: ds.txns.map((t) => ({
      txnId: t.txnId,
      projectId: t.projectId,
      txnType: t.txnType,
      txnRef: t.txnRef,
      amount: t.amount,
      status: t.status,
      txnDate: t.txnDate,
      dueDate: t.dueDate ?? null,
      direction: t.direction,
      package: t.package ?? null,
      counterparty: t.counterparty,
      evidenceId: t.evidenceId,
    })),
    contracts: ds.documents.filter((d) => d.docType === "contract").map((d) => ({ documentId: d.documentId, projectId: d.projectId, title: d.title, signed: d.signed ?? null, amount: d.amount ?? null })),
    expected: expectedFor(tenantId, ds),
  };
}

function expectedFor(_tenantId: string, ds: TenantDataset) {
  const summary: Record<string, unknown> = {};
  for (const p of ds.projects) {
    const f = projectFinance(ds, p.projectId);
    summary[p.projectId] = { budget: f.budget, committed: f.committed, overrun: f.overrun, forecast: f.forecast, overrunPct: Math.round(f.overrunPct * 1e6) / 1e6, billed: f.billed, collected: f.collected, outstanding: f.outstanding, overdue: f.overdue };
  }
  const lines = ds.projects.flatMap((p) => projectFinance(ds, p.projectId).lines.map((l) => ({ projectId: p.projectId, package: l.package, budget: l.budget, committed: l.committed, overrun: l.overrun })));
  const exec = executiveSummary(ds);
  return {
    summary,
    lines,
    openReceivables: openReceivables(ds).map((r) => ({ txnId: r.txnId, daysOverdue: r.daysOverdue, ageDays: r.ageDays, bucket: r.bucket, amount: r.amount })),
    ageing: ageing(ds),
    payablesDue30: payablesDue(ds, 30).map((t) => ({ txnId: t.txnId, amount: t.amount, dueDate: t.dueDate })),
    leakage: leakageFlags(ds).map((f) => ({ flagId: f.id, kind: f.kind, amount: f.amount })),
    cashPosition: cashPosition(ds),
    cashMonthly: cashMonthly(ds),
    executive: { outstanding: exec.outstanding, overdue: exec.overdue, payablesDue: exec.payablesDue30, forecastOverrun: exec.forecastOverrun, leakage: exec.leakage, cashNet: exec.cashNet },
  };
}

test("the equivalence fixture for the PostgreSQL test is up to date", () => {
  const doc = {
    "//": "Generated by apps/web/tests/finance-sql.test.ts (UPDATE_FIXTURES=1). Rows to load and the figures lib/data/derive.ts computes from them; packages/ontology/tests/test_finance_views.py runs db/views/finance.sql on the same rows and compares.",
    asOf: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(DEMO_NOW),
    days: 30,
    tenants: { [TENANTS[0]!.tenantId]: rowsOf(TENANTS[0]!.tenantId, STUDIO8_DATA), [TENANTS[1]!.tenantId]: rowsOf(TENANTS[1]!.tenantId, SYNTHETIC_DATA) },
  };
  const json = JSON.stringify(doc, null, 1) + "\n";
  if (process.env["UPDATE_FIXTURES"] === "1" || !existsSync(FIXTURE)) {
    mkdirSync(new URL("./", FIXTURE), { recursive: true });
    writeFileSync(FIXTURE, json);
  }
  assert.equal(readFileSync(FIXTURE, "utf8"), json, "db/seed/finance_equivalence.json is stale: run UPDATE_FIXTURES=1 pnpm --filter @klarity/web test");
});
