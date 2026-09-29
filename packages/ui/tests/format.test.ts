// Owner task: EB-97 Shared data components — Indian formatting.
import assert from "node:assert/strict";
import { test } from "node:test";

import { formatINR, formatINRShort, formatPercent, formatRelative, initials } from "../src/data/format.ts";

test("lakh and crore short forms", () => {
  assert.equal(formatINRShort(1840000), "₹18.4 lakh");
  assert.equal(formatINRShort(15300000), "₹1.53 crore");
  assert.equal(formatINRShort(100000), "₹1 lakh");
  assert.equal(formatINRShort(92500), "₹92,500");
  assert.equal(formatINRShort(-610000), "−₹6.1 lakh");
});

test("exact values use Indian digit grouping", () => {
  assert.equal(formatINR(1840000), "₹18,40,000");
  assert.equal(formatINR(15300000), "₹1,53,00,000");
  assert.equal(formatINR(-5000), "−₹5,000");
});

test("percent and relative time", () => {
  assert.equal(formatPercent(0.1203), "12%");
  assert.equal(formatPercent(0.125), "12.5%");
  const now = new Date("2026-09-30T12:00:00Z");
  assert.equal(formatRelative("2026-09-27T12:00:00Z", now), "3 days ago");
  assert.equal(formatRelative("2026-10-02T12:00:00Z", now), "in 2 days");
});

test("initials", () => {
  assert.equal(initials("Studio 8 Hats"), "S8");
  assert.equal(initials("demo"), "D");
});
