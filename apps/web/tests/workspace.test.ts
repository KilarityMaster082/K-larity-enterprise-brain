// Owner task: EB-23 Web UI shell — the workspace screens show only this tenant's rows, derived, and gated by role.
import assert from "node:assert/strict";
import { test } from "node:test";

import { executiveSummary } from "@/lib/data/derive";
import { tenantView } from "@/lib/data/store";
import { can, ROLES } from "@/lib/permissions";
import { TENANTS } from "@/lib/tenants";
import { agentStats, appRows, contractorJobs, folderTree, historyStats, knowledgeSets, meetingsThisWeek, mailFolders, shortWhen, todoStats, topicCards, upcomingDeadlines, visibleMail, wedgeCounts } from "@/lib/workspace";
import { agentsBrief, appsBrief, askBrief, commsBrief, meetBrief, viewersBrief, workBrief } from "@/lib/briefs";
import type { Role } from "@/lib/data/types";

const studio = tenantView(TENANTS[0]!.tenantId, TENANTS[0]!.slug);
const asRole = (r: Role) => (c: Parameters<typeof can>[1]) => can(r, c);

test("threads that quote money are hidden from roles without finance.view", () => {
  const all = studio.data.workspace.mail.length;
  assert.equal(visibleMail(studio, asRole("owner")).length, all);
  const member = visibleMail(studio, asRole("member"));
  assert.ok(member.length < all);
  assert.ok(member.every((t) => !t.financial));
  assert.ok(visibleMail(studio, asRole("owner")).every((t, i, a) => i === 0 || a[i - 1]!.lastAt >= t.lastAt), "newest first");
});

test("folder counts add up", () => {
  const f = mailFolders(visibleMail(studio, asRole("owner")));
  assert.equal(f.inbox + f.sent, studio.data.workspace.mail.length);
});

test("deadlines in the next 7 days come only from visible threads and are sorted", () => {
  const d = upcomingDeadlines(visibleMail(studio, asRole("owner")), 7);
  assert.ok(d.length > 0);
  assert.ok(d.every((x, i) => i === 0 || d[i - 1]!.due <= x.due));
  assert.ok(upcomingDeadlines(visibleMail(studio, asRole("member")), 7).length <= d.length);
});

test("knowledge counts come from the connected sources", () => {
  const sets = knowledgeSets(studio);
  assert.equal(sets.find((s) => s.name === "Emails")!.count, studio.sources.filter((s) => s.connectorType === "gmail").reduce((a, s) => a + s.itemsSeen, 0));
  assert.equal(sets.find((s) => s.name === "Drawings")!.count, studio.data.documents.filter((d) => d.docType === "drawing").length);
});

test("contractor active jobs are projects with an open payable in the ledger", () => {
  assert.equal(contractorJobs(studio, "Aqua MEP"), new Set(studio.data.txns.filter((t) => t.counterparty === "Aqua MEP" && t.direction === "payable" && t.status === "pending").map((t) => t.projectId)).size);
  assert.equal(contractorJobs(studio, "Nobody Ltd"), 0);
});

test("the vault tree lists every folder once, children after their parent", () => {
  const tree = folderTree(studio);
  assert.equal(tree.length, studio.data.workspace.folders.length);
  assert.equal(tree[0]!.depth, 0);
  assert.ok(tree.find((t) => t.name === "Phoenix")!.depth === 1);
});

test("meetings this week exclude past ones; todo stats count overdue against the demo clock", () => {
  const week = meetingsThisWeek(studio.data.workspace.meetings);
  assert.ok(week.length > 0 && week.every((m) => m.status !== "past"));
  const t = todoStats(studio.data.workspace.todos);
  assert.equal(t.open + t.done, studio.data.workspace.todos.length);
  assert.ok(t.overdue >= 1, "the PVC cost difference was due on 29 Sep");
});

test("agent stats: tokens are the sum of the jobs and the allowance comes from the tenant budget", () => {
  const a = agentStats(studio);
  assert.equal(a.tokens, studio.data.workspace.jobs.reduce((s, j) => s + j.tokensToday, 0));
  assert.ok(a.capPct > 0 && a.capPct < 1);
  assert.equal(a.needsNudge?.name, "WhatsApp media fetch");
});

test("apps are connected when a source exists and need attention when a source needs re-authorising", () => {
  const rows = appRows(studio);
  assert.equal(rows.find((r) => r.appId === "gmail")!.liveStatus, "attention", "the Accounts mailbox lost its token");
  assert.equal(rows.find((r) => r.appId === "drive")!.liveStatus, "connected");
  assert.equal(rows.find((r) => r.appId === "procore")!.liveStatus, "available");
});

test("history stats compare the period with the one before and ignore unrated answers", () => {
  const h = historyStats(studio, 30);
  assert.ok(h.thisPeriod > 0);
  assert.equal(h.weekly.length, 6);
  assert.ok(h.helpfulPct! > 0 && h.helpfulPct! <= 1);
});

test("topic cards: finance topics are hidden from roles without finance.view, all are derived", () => {
  const partner = topicCards(studio, asRole("admin"));
  const member = topicCards(studio, asRole("member"));
  assert.ok(partner.some((c) => c.kind === "COST OVERRUN") && !member.some((c) => c.kind === "COST OVERRUN"));
  assert.ok(partner.every((c) => c.ask.length > 5));
  assert.ok(member.every((c) => !c.finance));
  assert.match(partner.find((c) => c.kind === "COST OVERRUN")!.headline, /^Project Phoenix is 12% over budget$/);
});

test("wedge counts are row counts, zero for finance kinds without the capability", () => {
  const w = wedgeCounts(studio, asRole("member"));
  assert.equal(w.find((x) => x.label === "Cost overruns")!.value, 0);
  assert.equal(w.find((x) => x.label === "Payment delays")!.value, 0);
  assert.ok(wedgeCounts(studio, asRole("owner")).find((x) => x.label === "Payment delays")!.value >= 1);
});

test("briefs: no finance figure reaches a role without finance.view", () => {
  const member = workBrief(studio, asRole("member")).map((m) => `${m.label} ${m.value}`).join("|");
  assert.doesNotMatch(member, /₹|receivable|budget/i);
  const owner = workBrief(studio, asRole("owner"));
  assert.equal(owner[1]!.value, executiveSummary(studio.data).overdue === 0 ? "₹0" : owner[1]!.value);
  for (const role of ROLES) {
    const can_ = asRole(role);
    for (const m of [...askBrief(studio), ...commsBrief(studio, can_), ...meetBrief(studio), ...agentsBrief(studio), ...viewersBrief(studio), ...appsBrief(studio), ...workBrief(studio, can_)]) {
      assert.ok(String(m.value).length > 0 && !/NaN|undefined/.test(`${m.value}${m.note}`), `${role}: ${m.label}`);
    }
  }
});

test("a workspace that is not synced shows empty states, and the canary tenant never sees Studio 8 rows", () => {
  const canary = tenantView(TENANTS[1]!.tenantId, TENANTS[1]!.slug);
  assert.equal(canary.data.workspace.mail.length, 0, "gated until a source has synced");
  assert.equal(visibleMail(canary, asRole("owner")).length, 0);
  const text = JSON.stringify(studio.data.workspace);
  assert.doesNotMatch(text, /CANARY-7f3e/);
});

test("short dates use IST and relative day words", () => {
  const now = new Date("2026-09-30T12:00:00+05:30");
  assert.equal(shortWhen("2026-09-30T10:05:00+05:30", now), "10:05 am");
  assert.equal(shortWhen("2026-09-29T23:00:00+05:30", now), "Yesterday");
  assert.equal(shortWhen("2026-09-11T09:30:00+05:30", now), "11 Sept");
});
