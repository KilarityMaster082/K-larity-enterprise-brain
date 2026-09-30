// Owner task: EB-91 UI design system — chart geometry is pure and deterministic.
import assert from "node:assert/strict";
import { test } from "node:test";

import { linePath, sectorPath, sparkPath, wedgeGeometry } from "../src/eb/geometry.ts";

test("sparkPath scales the series into the box with the lowest value at the bottom", () => {
  const d = sparkPath([1, 5, 3], 40, 20, 2);
  assert.match(d, /^M2\.0 18\.0 L20\.0 2\.0 L38\.0 10\.0$/);
});

test("sparkPath returns nothing for fewer than two points and survives a flat series", () => {
  assert.equal(sparkPath([4]), "");
  assert.doesNotMatch(sparkPath([3, 3, 3]), /NaN/);
});

test("sectorPath closes and stays finite", () => {
  const d = sectorPath(150, 150, 30, 120, 0, 1);
  assert.match(d, /^M[\d.,-]+ L[\d.,-]+ A120,120 0 0 1 [\d.,-]+ L[\d.,-]+ A30,30 0 0 0 [\d.,-]+Z$/);
});

test("wedgeGeometry gives each category a wedge whose inner radius grows with its value", () => {
  const w = wedgeGeometry([
    { label: "a", value: 2 },
    { label: "b", value: 12 },
  ]);
  assert.equal(w.length, 2);
  assert.equal(w[0]!.label, "a");
  assert.ok(w.every((x) => !/NaN/.test(x.outer + x.inner)));
  assert.notEqual(w[0]!.inner, w[1]!.inner);
});

test("wedge labels flip to light text when they sit on the dark outer ring", () => {
  const w = wedgeGeometry([
    { label: "small", value: 1 },
    { label: "big", value: 12 },
  ]);
  assert.equal(w[0]!.onDark, true);
  assert.equal(w[1]!.onDark, false);
});

test("linePath is monotonic in x and never produces NaN", () => {
  const d = linePath([10, 20, 15, 30]);
  assert.doesNotMatch(d, /NaN/);
  assert.ok(d.startsWith("M0 "));
});
