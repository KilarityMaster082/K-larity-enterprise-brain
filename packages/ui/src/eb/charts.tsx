// Owner task: EB-91 UI design system — Enterprise Brain charts: sparkline, bar rows, columns, wedge chart,
// line chart, waveform, node graph. Server-safe SVG/CSS; animation is CSS (disabled by prefers-reduced-motion).
// Every chart takes plain numbers already derived elsewhere: nothing here computes a business figure.
import type { ReactNode } from "react";

import { sparkPath, wedgeGeometry } from "./geometry";
export { linePath, sectorPath, sparkPath, wedgeGeometry, type Wedge } from "./geometry";

// ---------------------------------------------------------------- components
export function Sparkline({ series, w = 40, h = 19, label }: { series: readonly number[]; w?: number; h?: number; label?: string }) {
  const d = sparkPath(series, w, h);
  if (!d) return null;
  return (
    <svg className="eb-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={d} fill="none" stroke="#111" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ ["--len" as string]: 120 }} />
    </svg>
  );
}

export type FillTone = "black" | "lime" | "lavender" | "green" | "pink" | "danger";

/** Label / striped track / value. `pct` is 0–100 of the track. */
export function BarRow({ label, value, pct, tone = "black", thin, labelWidth }: { label: ReactNode; value: ReactNode; pct: number; tone?: FillTone; thin?: boolean; labelWidth?: number }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="eb-barrow">
      <span className="l eb-trunc" style={labelWidth ? { width: labelWidth } : undefined}>
        {label}
      </span>
      <div className={`eb-track${thin ? " thin" : ""}`} role="img" aria-label={`${Math.round(w)}% of track`}>
        <div className="eb-fill" data-tone={tone === "black" ? undefined : tone} style={{ width: `${w}%` }} />
      </div>
      <span className="v">{value}</span>
    </div>
  );
}

export function ProgressTrack({ pct, tone = "black", label, dark }: { pct: number; tone?: FillTone; label: string; dark?: boolean }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className={`eb-track thin${dark ? " dark" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(w)} aria-label={label}>
      <div className="eb-fill" data-tone={tone === "black" ? undefined : tone} style={{ width: `${w}%` }} />
    </div>
  );
}

export interface ColumnDatum {
  label: string;
  /** Text shown above the column. */
  value: string;
  /** 0–100 of the plot height. */
  pct: number;
  color: string;
}

export function Columns({ data, label }: { data: readonly ColumnDatum[]; label: string }) {
  return (
    <figure style={{ margin: 0 }}>
      <div className="eb-columns" aria-hidden="true">
        {data.map((d, i) => (
          <div className="eb-col-item" key={d.label}>
            <span style={{ fontWeight: 600 }} className="eb-num">
              {d.value}
            </span>
            <div className="eb-col-bar" style={{ height: `${Math.max(4, Math.min(100, d.pct))}%`, background: d.color, animationDelay: `${i * 0.1}s` }} />
            <span>{d.label}</span>
          </div>
        ))}
      </div>
      <table className="visually-hidden">
        <caption>{label}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <th scope="row">{d.label}</th>
              <td>{d.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function WedgeChart({ items, label, size = 300 }: { items: readonly { label: string; value: number }[]; label: string; size?: number }) {
  const wedges = wedgeGeometry(items, size);
  return (
    <figure style={{ margin: 0, display: "grid", placeItems: "center" }}>
      <svg width="100%" style={{ maxWidth: 340 }} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
        <defs>
          <linearGradient id="eb-wedge-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ebe4e0" />
            <stop offset="1" stopColor="#d6cee8" />
          </linearGradient>
        </defs>
        {wedges.map((w) => (
          <g key={w.label} style={{ transformOrigin: `${size / 2}px ${size / 2}px`, animation: `eb-wedge 0.8s ${w.delay} both` }}>
            <path d={w.outer} fill="#5a5757" stroke="#5a5757" strokeWidth="8" strokeLinejoin="round" />
            <path d={w.inner} fill="url(#eb-wedge-grad)" stroke="#e6dfe9" strokeWidth="8" strokeLinejoin="round" />
            <text x={w.x} y={w.y} textAnchor="middle" fontSize="15" fontWeight="600" fill={w.onDark ? "#f2f2f2" : "#1b1b1b"}>
              {w.value}
            </text>
            <text x={w.x} y={w.y2} textAnchor="middle" fontSize="7.5" fill={w.onDark ? "#f2f2f2" : "#1b1b1b"}>
              {w.label}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  );
}

export function LineChart({ series, label }: { series: readonly { name: string; values: readonly number[]; color: string; dashed?: boolean; width?: number }[]; label: string }) {
  const all = series.flatMap((s) => s.values);
  const min = Math.min(...all);
  const max = Math.max(...all);
  // One shared scale so the two lines are comparable.
  const norm = (v: number) => (max === min ? 0.5 : (v - min) / (max - min));
  return (
    <svg width="100%" height="104" viewBox="0 0 900 140" preserveAspectRatio="none" role="img" aria-label={label}>
      {series.map((s) => {
        const d = s.values
          .map((v, i) => `${i ? "L" : "M"}${((i * 900) / Math.max(1, s.values.length - 1)).toFixed(0)} ${(130 - norm(v) * 110).toFixed(0)}`)
          .join(" ");
        return (
          <path
            key={s.name}
            d={d}
            fill="none"
            stroke={s.color}
            strokeWidth={s.width ?? 3}
            strokeDasharray={s.dashed ? "3 4" : 1400}
            vectorEffect="non-scaling-stroke"
            style={s.dashed ? undefined : { strokeDashoffset: 0, animation: "eb-draw 2s both", ["--len" as string]: 1400 }}
          />
        );
      })}
    </svg>
  );
}

export function StripedPlaceholder({ children, height, label }: { children?: ReactNode; height?: number; label?: string }) {
  return (
    <div className="eb-placeholder" style={height ? { minHeight: height } : undefined} role="img" aria-label={label ?? "Placeholder for content that loads from the source"}>
      {children}
    </div>
  );
}

/** Deterministic waveform: heights come from a seed so server and client render the same bars. */
export function Waveform({ bars = 56, playing, progress = 0, seed = 7 }: { bars?: number; playing?: boolean; progress?: number; seed?: number }) {
  const hs = Array.from({ length: bars }, (_, i) => 0.25 + 0.75 * Math.abs(Math.sin((i + seed) * 1.7) * Math.cos((i + seed) * 0.45)));
  return (
    <div className="eb-wave" data-playing={playing ? "true" : "false"} aria-hidden="true">
      {hs.map((h, i) => (
        <i key={i} data-past={i / bars < progress ? "true" : undefined} style={{ ["--h" as string]: h.toFixed(2), ["--d" as string]: `${((i % 9) * 0.11).toFixed(2)}s` }} />
      ))}
    </div>
  );
}
