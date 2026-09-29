// Owner task: EB-90 Brand guide and logo sign-off — the palette must stay WCAG 2.1 AA in both themes.
// Run: node --test packages/ui/tests   (Node 24+ runs TypeScript directly; no dependencies)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");

function block(re: RegExp): Record<string, string> {
  const m = css.match(re);
  assert.ok(m, `block not found: ${re}`);
  const out: Record<string, string> = {};
  for (const [, k, v] of m[1]!.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[k!] = v!.toLowerCase();
  return out;
}

const light = block(/^:root \{([\s\S]*?)\n\}/m);
const darkMedia = block(/prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([\s\S]*?)\n  \}\n\}/);
const darkAttr = block(/^:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/m);

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

// [foreground token, background tokens]; every pair is body-size text, so 4.5:1.
const TEXT_PAIRS: [string, string[]][] = [
  ["text", ["bg", "surface", "surface-2", "surface-3"]],
  ["text-2", ["bg", "surface", "surface-2", "surface-3"]],
  ["text-3", ["bg", "surface", "surface-2"]],
  ["brand-ink", ["bg", "surface", "surface-2", "brand-weak"]],
  ["on-brand", ["brand", "brand-hover"]],
  ["ok", ["ok-weak", "surface"]],
  ["warn", ["warn-weak", "surface"]],
  ["danger", ["danger-weak", "surface"]],
  ["info", ["info-weak", "surface"]],
  ["mark-text", ["mark-bg"]],
];

for (const [name, theme] of [["light", light], ["dark", darkAttr]] as const) {
  test(`${name}: every text pair meets WCAG AA (4.5:1)`, () => {
    for (const [fg, bgs] of TEXT_PAIRS) {
      for (const bg of bgs) {
        assert.ok(theme[fg] && theme[bg], `${name}: missing token ${fg} or ${bg}`);
        const r = ratio(theme[fg]!, theme[bg]!);
        assert.ok(r >= 4.5, `${name}: --${fg} on --${bg} is ${r.toFixed(2)}:1 (needs 4.5)`);
      }
    }
  });
}

test("focus ring is at least 3:1 against every surface (WCAG 1.4.11)", () => {
  for (const [name, theme] of [["light", light], ["dark", darkAttr]] as const) {
    for (const bg of ["bg", "surface", "surface-2", "brand-weak"]) {
      const r = ratio(theme["focus-ring"]!, theme[bg]!);
      assert.ok(r >= 3, `${name}: focus ring on --${bg} is ${r.toFixed(2)}:1`);
    }
  }
});

test("the dark theme is defined identically for the OS setting and the manual toggle", () => {
  assert.deepEqual(darkMedia, darkAttr);
});

test("both themes define the same tokens", () => {
  const colours = (t: Record<string, string>) => Object.keys(t).sort();
  const shared = ["bg", "surface", "text", "brand", "brand-ink", "ok", "warn", "danger", "info", "focus-ring"];
  for (const k of shared) assert.ok(light[k] && darkAttr[k], `token --${k} missing in a theme`);
  assert.deepEqual(colours(darkAttr).filter((k) => !(k in light)), [], "dark has tokens light lacks");
});

test("the brand orange is the logo's orange", () => {
  assert.equal(light.brand, "#fd5910");
  assert.equal(darkAttr.brand, "#fd5910");
});
