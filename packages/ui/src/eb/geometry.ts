// Owner task: EB-91 UI design system — pure chart geometry (no React), unit-tested in tests/geometry.test.ts.

/** Polyline path for a series scaled into a w×h box (higher value = higher on screen). */
export function sparkPath(series: readonly number[], w = 40, h = 19, pad = 2): string {
  if (series.length < 2) return "";
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  return series
    .map((v, i) => {
      const x = (i * (w - 2 * pad)) / (series.length - 1) + pad;
      const y = h - pad - ((v - min) / span) * (h - 2 * pad);
      return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

/** Annular sector path (used by the wedge chart). Angles in radians, clockwise from 3 o'clock. */
export function sectorPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const p = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  return `M${p(r0, a0)} L${p(r1, a0)} A${r1},${r1} 0 0 1 ${p(r1, a1)} L${p(r0, a1)} A${r0},${r0} 0 0 0 ${p(r0, a0)}Z`;
}

export interface Wedge {
  outer: string;
  inner: string;
  x: number;
  y: number;
  y2: number;
  value: number;
  label: string;
  delay: string;
  /** The label sits on the dark outer ring (the inner wedge is shorter than the label radius). */
  onDark: boolean;
}

/** Wedge geometry for n categories; the inner wedge's radius grows with value / max. */
export function wedgeGeometry(items: readonly { label: string; value: number }[], size = 300): Wedge[] {
  const n = items.length || 1;
  const max = Math.max(1, ...items.map((i) => i.value));
  const c = size / 2;
  const ri = size * 0.087;
  const R = size * 0.427;
  const step = (Math.PI * 2) / n;
  return items.map((it, i) => {
    const a0 = -Math.PI / 2 + i * step + 0.03;
    const a1 = a0 + step - 0.06;
    const m = (a0 + a1) / 2;
    const r = ri + (R - ri) * (0.35 + (0.65 * it.value) / max) * 0.86;
    const q = 0.62 * R + 6;
    return {
      outer: sectorPath(c, c, ri + 7, R - 7, a0, a1),
      inner: sectorPath(c, c, ri + 7, Math.max(ri + 9, r - 7), a0 + 0.02, a1 - 0.02),
      x: c + q * Math.cos(m),
      y: c + q * Math.sin(m) - 2,
      y2: c + q * Math.sin(m) + 9,
      value: it.value,
      label: it.label,
      delay: `${(i * 0.08).toFixed(2)}s`,
      onDark: q > r - 4,
    };
  });
}

export function linePath(series: readonly number[], w = 900, h = 140): string {
  if (series.length < 2) return "";
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  return series
    .map((v, i) => `${i ? "L" : "M"}${((i * w) / (series.length - 1)).toFixed(0)} ${(h - 10 - ((v - min) / span) * (h - 30)).toFixed(0)}`)
    .join(" ");
}

