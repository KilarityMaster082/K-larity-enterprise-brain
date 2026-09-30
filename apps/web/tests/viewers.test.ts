// Owner task: EB-102 File viewers — formula evaluator, line diff and PDF search.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { diffLines, diffStats } from "../lib/viewers/diff";
import { colIndex, colLetters, evaluateSheet } from "../lib/viewers/sheet";
import { searchPages, splitRuns } from "../lib/viewers/search";

describe("sheet evaluator", () => {
  it("multiplies row cells and sums a column range", () => {
    const v = evaluateSheet([
      ["a", 2, 10, { f: "=B2*C2" }],
      ["b", 3, 5, { f: "=B3*C3" }],
      ["Total", "", "", { f: "=SUM(D2:D3)" }],
    ]);
    assert.equal(v[0]![3], 20);
    assert.equal(v[1]![3], 15);
    assert.equal(v[2]![3], 35);
  });
  it("respects precedence and parentheses, and tidies float noise", () => {
    const v = evaluateSheet([[{ f: "=1+2*3" }, { f: "=(1+2)*3" }, { f: "=0.1+0.2" }, { f: "=-A2+10" }]]);
    assert.deepEqual(v[0], [7, 9, 0.3, 3]);
  });
  it("supports AVERAGE, MIN, MAX, COUNT and ignores text in ranges", () => {
    const v = evaluateSheet([[4, { f: "=AVERAGE(A2:A4)" }, { f: "=MIN(A2:A4)" }, { f: "=MAX(A2:A4)" }, { f: "=COUNT(A2:A4)" }], ["x"], [8]]);
    assert.deepEqual(v[0]!.slice(1), [6, 4, 8, 2]);
  });
  it("returns spreadsheet errors instead of throwing", () => {
    const v = evaluateSheet([[{ f: "=1/0" }, { f: "=B2" }, { f: "=A2" }, { f: "=FOO(1)" }, { f: "=1+" }, { f: "=A1" }, { f: "=C2" }]]);
    assert.equal(v[0]![0], "#DIV/0!");
    assert.equal(v[0]![1], "#CYCLE!");
    assert.equal(v[0]![3], "#NAME?");
    assert.equal(v[0]![4], "#ERROR!");
    assert.equal(v[0]![5], "#REF!"); // row 1 is the header row
  });
  it("propagates an error through dependants", () => {
    const v = evaluateSheet([[{ f: "=1/0" }, { f: "=A2+1" }, { f: "=SUM(A2:B2)" }]]);
    assert.equal(v[0]![1], "#DIV/0!");
    assert.equal(v[0]![2], "#DIV/0!");
  });
  it("converts column letters both ways", () => {
    assert.equal(colIndex("A"), 0);
    assert.equal(colIndex("AA"), 26);
    assert.equal(colLetters(0), "A");
    assert.equal(colLetters(27), "AB");
  });
});

describe("line diff", () => {
  it("marks added and removed lines with both line numbers", () => {
    const d = diffLines("a\nb\nc", "a\nx\nc\nd");
    assert.deepEqual(d.map((l) => l.kind), ["same", "del", "add", "same", "add"]);
    assert.deepEqual(diffStats(d), { added: 2, removed: 1 });
    assert.equal(d[3]!.oldNo, 3);
    assert.equal(d[3]!.newNo, 3);
  });
  it("handles an empty side", () => {
    assert.deepEqual(diffStats(diffLines("", "a\nb")), { added: 2, removed: 0 });
    assert.deepEqual(diffStats(diffLines("a\nb", "")), { added: 0, removed: 2 });
  });
});

describe("pdf search", () => {
  const pages = [{ n: 1, lines: ["Steel ISMB 450", "ismb again ISMB"] }, { n: 2, lines: ["nothing"] }];
  it("finds every case-insensitive match with page and line", () => {
    const h = searchPages(pages, "ismb");
    assert.equal(h.length, 3);
    assert.deepEqual(h[0], { page: 1, line: 0, start: 6, end: 10 });
  });
  it("ignores very short queries", () => assert.deepEqual(searchPages(pages, "i"), []));
  it("splits runs and merges overlaps", () => {
    assert.deepEqual(splitRuns("abcdef", [{ start: 1, end: 3 }, { start: 2, end: 4 }]), [
      { text: "a", mark: false }, { text: "bcd", mark: true }, { text: "ef", mark: false },
    ]);
  });
});
