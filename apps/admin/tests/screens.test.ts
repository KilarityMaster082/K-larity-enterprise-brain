// Owner task: EB-100 Admin console shell — the operator screen registry (46–54) must match the catalog and the route files, and
// every page must require the operator session before it reads anything.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { OP_SCREENS, opLauncher, opRail } from "@/lib/screens";

const root = join(import.meta.dirname, "..");
const catalog = readFileSync(join(root, "../../docs/architecture/SCREENS_CATALOG.md"), "utf8");
const rows = [...catalog.matchAll(/^\| \*\*(\d+)\*\* \| \*\*(.+?)\*\* \| `admin:3001(\/[^`]*)` \|/gm)].map((m) => ({ n: Number(m[1]), route: m[3]! }));

test("the registry lists screens 46–54 in order and matches the catalog routes", () => {
  assert.deepEqual(OP_SCREENS.map((s) => s.n), [46, 47, 48, 49, 50, 51, 52, 53, 54]);
  assert.equal(rows.length, 9);
  for (const r of rows) assert.equal(OP_SCREENS.find((s) => s.n === r.n)!.route, r.route, `screen ${r.n}`);
});

test("every screen has a page file, and every page other than /login checks the operator session", () => {
  for (const s of OP_SCREENS) {
    const page = join(root, "app", s.route.replace(/^\//, ""), "page.tsx");
    assert.ok(existsSync(page), `screen ${s.n}: ${page}`);
    if (s.route !== "/login") assert.match(readFileSync(page, "utf8"), /getOperator\(\)/, `screen ${s.n} must call getOperator()`);
  }
});

test("the rail and launcher only point at registered routes", () => {
  const routes = new Set(OP_SCREENS.map((s) => s.route));
  for (const r of opRail()) assert.ok(routes.has(r.href), r.href);
  const items = opLauncher().flatMap((g) => g.items);
  assert.equal(items.length, 8);
  assert.ok(items.every((i) => i.href.startsWith("/") && !i.href.includes("[")));
});

test("the tenant route parameter is named [id] like the catalog", () => {
  assert.ok(existsSync(join(root, "app/tenants/[id]/page.tsx")));
  assert.ok(!readdirSync(join(root, "app/tenants")).includes("[tenantId]"));
});

test("state-changing actions verify the operator session and audit", () => {
  const src = readFileSync(join(root, "lib/actions.ts"), "utf8");
  for (const fn of ["replayDeadLetterAction", "dismissDeadLetterAction", "setGatewayBudgetAction"]) {
    const body = src.slice(src.indexOf(`function ${fn}`));
    assert.match(body.slice(0, 260), /await op\(\)/, `${fn} must call op()`);
  }
  const ops = readFileSync(join(root, "lib/ops.ts"), "utf8");
  for (const action of ["dlq.replay", "dlq.dismiss", "gateway.set_budget"]) assert.match(ops, new RegExp(`audit\\(operator, "${action}"`));
});
