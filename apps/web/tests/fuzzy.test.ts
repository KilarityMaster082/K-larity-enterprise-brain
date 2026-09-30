// Owner task: EB-101 Command palette and global search — the quick switcher ranks exact > prefix > word > substring > letters.
import assert from "node:assert/strict";
import { test } from "node:test";

import { fuzzyScore } from "@/lib/fuzzy";

test("ranking order", () => {
  const scores = ["Finance", "Finance & Cash Control", "Cash Finance", "Refinancer", "F i n"].map((t) => fuzzyScore("finance", t));
  assert.equal(scores[0], 100);
  assert.ok(scores[1]! > scores[2]!, "prefix beats word prefix");
  assert.ok(scores[2]! > scores[3]!, "word prefix beats substring");
  assert.equal(scores[4], 0, "missing letters do not match");
});

test("letters in order match loosely; an empty query matches everything; a miss scores zero", () => {
  assert.ok(fuzzyScore("fcc", "Finance & Cash Control") > 0);
  assert.ok(fuzzyScore("", "anything") > 0);
  assert.equal(fuzzyScore("zzz", "Ask Brain"), 0);
  assert.equal(fuzzyScore("ltrc", "Control"), 0, "letters must appear in order");
});
