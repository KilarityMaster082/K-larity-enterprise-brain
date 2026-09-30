// Owner task: EB-91 UI design system — Enterprise Brain kit: bento cards, pills, layout helpers.
// Stateless and server-component safe. Tones and sizes map to the handoff palette (docs/architecture/
// design_handoff_enterprise_brain/README.md); the CSS lives in styles/eb.css.
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, CSSProperties, ElementType, ReactNode } from "react";

export type BentoTone = "lime" | "black" | "sky" | "lavender" | "pink" | "green" | "cream" | "white" | "glass" | "strong" | "hero" | "graphite";
export type PillTone = "default" | "black" | "lime" | "outline" | "outline-dark" | "glass" | "pink" | "cream" | "green" | "sky" | "lavender" | "danger" | "mono";

type Cols = CSSProperties & { "--cols"?: string; "--align"?: string };

/** CSS grid with an explicit column template, e.g. `cols="1.25fr 1fr"`. Collapses to one column on narrow screens. */
export function Grid({
  cols,
  tight,
  align,
  className,
  children,
  keepTwo,
  as: Tag = "div",
}: {
  cols: string;
  tight?: boolean;
  align?: "start" | "center" | "end" | "stretch";
  keepTwo?: boolean;
  className?: string;
  children: ReactNode;
  as?: ElementType;
}) {
  const style: Cols = { "--cols": cols, ...(align ? { "--align": align } : {}) };
  return (
    <Tag className={["eb-grid", tight && "tight", keepTwo && "keep-2", className].filter(Boolean).join(" ")} style={style}>
      {children}
    </Tag>
  );
}

export function Stack({ tight, className, children }: { tight?: boolean; className?: string; children: ReactNode }) {
  return <div className={["eb-stack", tight && "tight", className].filter(Boolean).join(" ")}>{children}</div>;
}

export function Row({ nowrap, className, children, style }: { nowrap?: boolean; className?: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div className={["eb-row", nowrap && "nowrap", className].filter(Boolean).join(" ")} style={style}>
      {children}
    </div>
  );
}

export interface BentoProps {
  tone?: BentoTone;
  /** Column span inside a Grid (2–4). */
  span?: 2 | 3 | 4;
  rows?: 2;
  /** Lay out children as a column that spreads from top to bottom (label / value / note). */
  fill?: boolean;
  pad?: "sm" | "lg" | "0";
  enter?: boolean;
  className?: string;
  children: ReactNode;
  as?: ElementType;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-live"?: "polite" | "assertive" | "off";
  role?: string;
  style?: CSSProperties;
}

export function Bento({ tone = "glass", span, rows, fill, pad, enter, className, children, as: Tag = "section", style, ...aria }: BentoProps) {
  return (
    <Tag
      className={["eb-bento", className].filter(Boolean).join(" ")}
      data-tone={tone}
      data-span={span}
      data-rows={rows}
      data-fill={fill ? "" : undefined}
      data-pad={pad}
      data-enter={enter ? "" : undefined}
      style={style}
      {...aria}
    >
      {children}
    </Tag>
  );
}

/** Card header line: title on the left, optional tag on the right. */
export function BentoHead({ title, aside, eyebrow }: { title: ReactNode; aside?: ReactNode; eyebrow?: boolean }) {
  return (
    <div className="eb-row nowrap" style={{ justifyContent: "space-between" }}>
      {eyebrow ? <h2 className="eb-eyebrow">{title}</h2> : <h2 className="eb-h">{title}</h2>}
      {aside ? <span className="eb-row nowrap">{aside}</span> : null}
    </div>
  );
}

function pillAttrs(tone: PillTone, size?: "sm" | "lg", active?: boolean) {
  return { "data-tone": tone === "default" ? undefined : tone, "data-size": size, "data-active": active ? "true" : undefined } as const;
}

export function Pill({ tone = "default", size, active, className, children, title }: { tone?: PillTone; size?: "sm" | "lg"; active?: boolean; className?: string; children: ReactNode; title?: string }) {
  return (
    <span className={["eb-pill", className].filter(Boolean).join(" ")} title={title} {...pillAttrs(tone, size, active)}>
      {children}
    </span>
  );
}

export function PillButton({
  tone = "default",
  size,
  active,
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: PillTone; size?: "sm" | "lg"; active?: boolean }) {
  return <button type={type} className={["eb-pill", className].filter(Boolean).join(" ")} {...pillAttrs(tone, size, active)} {...rest} />;
}

export function PillLink({ tone = "default", size, active, className, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { tone?: PillTone; size?: "sm" | "lg"; active?: boolean }) {
  // eslint-disable-next-line jsx-a11y/anchor-has-content -- children arrive through rest
  return <a className={["eb-pill", className].filter(Boolean).join(" ")} {...pillAttrs(tone, size, active)} {...rest} />;
}

/** The "From ledger" style tag drawn on figures that come from a reviewed SQL view. */
export function OriginTag({ view, tone = "outline" }: { view: string; tone?: "outline" | "outline-dark" }) {
  return (
    <span className="eb-pill" data-tone={tone} data-size="sm" title={`Computed by the reviewed SQL view ${view}`} style={{ fontWeight: 600 }}>
      From ledger
    </span>
  );
}

export function Avatar({ label, tone, small }: { label: string; tone?: "lime" | "sky" | "pink" | "lavender" | "green" | "cream"; small?: boolean }) {
  const bg = tone && tone !== "lime" ? `var(--eb-${tone})` : undefined;
  return (
    <span className={`eb-avatar${small ? " eb-avatar-sm" : ""}`} style={bg ? { background: bg } : undefined} aria-hidden="true">
      {label}
    </span>
  );
}

export function AvatarStack({ people }: { people: { label: string; tone?: "lime" | "sky" | "pink" | "lavender" | "green" | "cream" }[] }) {
  return (
    <span className="eb-avatars" aria-hidden="true">
      {people.map((p) => (
        <Avatar key={p.label} label={p.label} tone={p.tone} small />
      ))}
    </span>
  );
}

export function Dot({ large, ink, label }: { large?: boolean; ink?: boolean; label?: string }) {
  return <span className={`eb-dot${ink ? " eb-dot-ink" : ""}${large ? " eb-dot-lg" : ""}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}

/** Page-level "N / 54 · title · role · status" line shown above each screen. */
export function ScreenCrumb({ n, title, role, status }: { n: number; title: string; role: string; status: string }) {
  return (
    <div className="eb-crumbs">
      <span className="eb-crumb-n">{n} / 54</span>
      <span className="eb-crumb-t">
        {title} · {role}
      </span>
      <span className="eb-status">{status}</span>
    </div>
  );
}

/** Four-up metric strip at the top of a screen group: three pastel metrics (with sparkline) and the live card. */
export function Metric({
  label,
  value,
  note,
  tone,
  spark,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone: "lime" | "sky" | "lavender" | "pink" | "green" | "cream";
  spark?: ReactNode;
}) {
  return (
    <div className="eb-metric" style={{ background: `var(--eb-${tone})` }}>
      <div>
        <div className="eb-metric-l">{label}</div>
        <div className="eb-metric-v eb-num">{value}</div>
        {note ? <div className="eb-metric-n">{note}</div> : null}
      </div>
      {spark}
    </div>
  );
}

export function LiveCard({ people, count }: { people: { label: string; tone?: "lime" | "sky" | "pink" | "lavender" | "green" | "cream" }[]; count: number }) {
  return (
    <div className="eb-live" role="status">
      <AvatarStack people={people} />
      <div>
        <b>Live</b>
        <br />
        {count} {count === 1 ? "teammate" : "teammates"} here
      </div>
      <span style={{ marginLeft: "auto" }}>
        <Dot />
      </span>
    </div>
  );
}

/** Mono route label used in the top bar and on cards that show an origin. */
export function Mono({ children }: { children: ReactNode }) {
  return <span className="eb-mono">{children}</span>;
}

/** Text with a yellow highlighted span: the exact supporting passage of a piece of evidence. */
export function Highlighted({ text, start, end }: { text: string; start: number; end: number }) {
  if (!(start >= 0 && end > start && end <= text.length)) return <>{text}</>;
  return (
    <>
      {text.slice(0, start)}
      <mark className="eb-mark">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}
