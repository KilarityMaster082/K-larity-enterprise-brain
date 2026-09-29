// Owner task: EB-97 Shared data components — money, KPI tile, meter, bar chart, timeline, stepper.
// Every number component can carry its source (the reviewed SQL query that produced it) and an `onSource`
// or `href` drill-down, so no figure on screen is unexplained (CLAUDE.md rules 3 and 4).
import type { ReactNode } from "react";

import { Icon, type IconName } from "../components/Icon";
import { formatINR, formatINRShort } from "./format";

export function Money({ amount, exact, className }: { amount: number; exact?: boolean; className?: string }) {
  return (
    <span className={`money${amount < 0 ? " money-neg" : ""}${className ? ` ${className}` : ""}`} title={formatINR(amount)}>
      {exact ? formatINR(amount) : formatINRShort(amount)}
    </span>
  );
}

/** "From ledger" tag; renders as a link when `href` is given (drill-down to evidence rows). */
export function SourceTag({ query, href, label = "From ledger" }: { query?: string; href?: string; label?: string }) {
  const title = query ? `Computed by ${query}` : "Computed by a reviewed SQL query";
  const inner = (
    <>
      <Icon name="database" size={12} /> {label}
    </>
  );
  return href ? (
    <a className="source-tag" href={href} title={title}>
      {inner}
    </a>
  ) : (
    <span className="source-tag" title={title} style={{ cursor: "default" }}>
      {inner}
    </span>
  );
}

export function KpiTile({
  label,
  value,
  foot,
  href,
  tone,
  accent,
}: {
  label: string;
  value: ReactNode;
  foot?: ReactNode;
  href?: string;
  tone?: "danger";
  accent?: boolean;
}) {
  const cls = `kpi${accent ? " kpi-accent" : ""}${tone === "danger" ? " kpi-danger" : ""}`;
  const body = (
    <>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {foot ? <span className="kpi-foot">{foot}</span> : null}
    </>
  );
  return href ? (
    <a className={cls} href={href}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Meter({ value, max, label, format }: { value: number; max: number; label?: string; format?: (n: number) => string }) {
  const pct = max > 0 ? value / max : 0;
  const tone = pct > 1 ? "danger" : pct > 0.9 ? "warn" : "";
  const f = format ?? ((n: number) => String(n));
  return (
    <div className="meter">
      <div
        className="meter-track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${f(value)} of ${f(max)} (${Math.round(pct * 100)}%)`}
        aria-label={label}
      >
        <div className={`meter-fill ${tone}`} style={{ width: `${Math.min(pct, 1) * 100}%` }} />
      </div>
      <div className="meter-label">
        <span>
          {f(value)} of {f(max)}
        </span>
        <span>{Math.round(pct * 100)}%</span>
      </div>
    </div>
  );
}

export interface BarDatum {
  label: string;
  value: number;
  tone?: "1" | "2" | "3" | "danger" | "ok";
  href?: string;
}

/** Horizontal bar chart with a data-table alternative for screen readers and exact values. */
export function BarChart({
  data,
  label,
  format = formatINRShort,
  exactFormat = formatINR,
  valueHeader = "Amount",
}: {
  data: BarDatum[];
  label: string;
  format?: (n: number) => string;
  exactFormat?: (n: number) => string;
  valueHeader?: string;
}) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  return (
    <figure style={{ margin: 0 }}>
      <ul className="bars" aria-hidden="true">
        {data.map((d) => (
          <li key={d.label} className="bar-row">
            <span className="bar-label" title={d.label}>
              {d.href ? <a href={d.href}>{d.label}</a> : d.label}
            </span>
            <span className="bar-track">
              <span
                className={`bar-fill${d.tone && d.tone !== "1" ? ` tone-${d.tone}` : ""}`}
                style={{ width: `${(Math.abs(d.value) / max) * 100}%` }}
              />
            </span>
            <span className="bar-value" title={exactFormat(d.value)}>
              {format(d.value)}
            </span>
          </li>
        ))}
      </ul>
      <details className="chart-toggle">
        <summary className="muted" style={{ cursor: "pointer", fontSize: "var(--fs-xs)" }}>
          Show as table
        </summary>
        <table className="table" style={{ marginTop: 8 }}>
          <caption className="visually-hidden">{label}</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col" className="num">
                {valueHeader}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.label}>
                <td>{d.label}</td>
                <td className="num">{exactFormat(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <figcaption className="visually-hidden">{label}</figcaption>
    </figure>
  );
}

export interface TimelineItem {
  id: string;
  when: string;
  title: ReactNode;
  description?: ReactNode;
  icon?: IconName;
  tone?: "brand" | "danger" | "ok";
  extra?: ReactNode;
}

export function Timeline({ items, label }: { items: TimelineItem[]; label: string }) {
  return (
    <ol className="timeline" aria-label={label}>
      {items.map((i) => (
        <li key={i.id} className="tl-item" data-tone={i.tone}>
          <span className="tl-dot">
            <Icon name={i.icon ?? "clock"} size={12} />
          </span>
          <div className="stack-sm" style={{ gap: 2 }}>
            <span className="tl-when">{i.when}</span>
            <span className="tl-title">{i.title}</span>
            {i.description ? <span className="tl-desc">{i.description}</span> : null}
            {i.extra}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Stepper({ steps, current, label }: { steps: string[]; current: number; label: string }) {
  return (
    <ol className="stepper" aria-label={label}>
      {steps.map((s, i) => (
        <li
          key={s}
          className="step"
          data-state={i < current ? "done" : i === current ? "current" : "todo"}
          aria-current={i === current ? "step" : undefined}
        >
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );
}
