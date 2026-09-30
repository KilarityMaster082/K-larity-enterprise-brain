// Owner task: EB-91 UI design system — the Enterprise Brain palette keeps body text at WCAG 2.1 AA (4.5:1) on every
// surface it is drawn on. The handoff uses dark ink on pastel fills and white on black; these are the pairs in use.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("../src/styles/eb-tokens.css", import.meta.url), "utf8");
const tok: Record<string, string> = {};
for (const [, k, v] of css.matchAll(/--eb-([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) tok[k!] = v!.toLowerCase();

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

const DARK_INK = "ink";
const FILLS = ["lime", "sky", "lavender", "pink", "green", "cream", "white"];

test("the handoff palette is present and unchanged", () => {
  assert.equal(tok["lime"], "#d2ff1f");
  assert.equal(tok["black"], "#0e0e0e");
  assert.equal(tok["ink"], "#1b1b1b");
  assert.equal(tok["sky"], "#c5effd");
  assert.equal(tok["lavender"], "#dcd3f8");
  assert.equal(tok["pink"], "#ffc9c9");
  assert.equal(tok["green"], "#c6e4c1");
  assert.equal(tok["cream"], "#fff4d6");
  assert.equal(tok["muted"], "#5d5b66");
});

test("ink text is readable on every pastel fill", () => {
  for (const f of FILLS) assert.ok(ratio(tok[DARK_INK]!, tok[f]!) >= 4.5, `ink on ${f}: ${ratio(tok[DARK_INK]!, tok[f]!).toFixed(2)}`);
});

test("secondary text passes on white and on the frame gradient ends", () => {
  for (const bg of ["#ffffff", "#e8e2f0", "#e3e9f4", "#f3e6e4"]) {
    assert.ok(ratio(tok["muted-2"]!, bg) >= 4.5, `muted-2 on ${bg}: ${ratio(tok["muted-2"]!, bg).toFixed(2)}`);
    assert.ok(ratio(tok["muted"]!, bg) >= 4.5, `muted on ${bg}: ${ratio(tok["muted"]!, bg).toFixed(2)}`);
  }
});

test("white and the dark-surface greys are readable on black and graphite", () => {
  for (const bg of ["black", "graphite"]) {
    for (const fg of ["on-dark", "on-dark-2", "on-dark-3", "lime"]) assert.ok(ratio(tok[fg]!, tok[bg]!) >= 4.5, `${fg} on ${bg}: ${ratio(tok[fg]!, tok[bg]!).toFixed(2)}`);
    assert.ok(ratio("#ffffff", tok[bg]!) >= 4.5);
  }
});

test("status text colours are readable on white and on the pastel that carries them", () => {
  for (const fg of ["danger", "warn", "ok"]) assert.ok(ratio(tok[fg]!, "#ffffff") >= 4.5, `${fg} on white: ${ratio(tok[fg]!, "#ffffff").toFixed(2)}`);
});

test("type never drops below 10px and the page is not scaled with CSS zoom", () => {
  for (const [, px] of css.matchAll(/--eb-t-[\w]+:\s*(\d+)px/g)) assert.ok(Number(px) >= 10, `type step ${px}px is below the 10px floor`);
  const eb = readFileSync(new URL("../src/styles/eb.css", import.meta.url), "utf8");
  assert.doesNotMatch(eb.replace(/\/\*[\s\S]*?\*\//g, ""), /\bzoom\s*:/, "the handoff says: no CSS zoom");
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /\bzoom\s*:/);
});
