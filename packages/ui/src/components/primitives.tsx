// Owner task: EB-91 UI design system — stateless primitives (server-component safe).
import type { ReactNode } from "react";

import { Icon, type IconName } from "./Icon";

export type Tone = "neutral" | "ok" | "warn" | "danger" | "info" | "brand" | "solid";

export function Badge({ tone = "neutral", icon, children, title }: { tone?: Tone; icon?: IconName; children: ReactNode; title?: string }) {
  const cls = tone === "neutral" ? "badge" : `badge badge-${tone}`;
  return (
    <span className={cls} title={title}>
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}

export type ButtonVariant = "default" | "primary" | "dark" | "ghost" | "danger";

export function buttonClass({ variant = "default", size, icon, block }: { variant?: ButtonVariant; size?: "sm"; icon?: boolean; block?: boolean } = {}): string {
  return ["btn", variant !== "default" && `btn-${variant}`, size === "sm" && "btn-sm", icon && "btn-icon", block && "btn-block"]
    .filter(Boolean)
    .join(" ");
}

export function PageHeader({
  title,
  lead,
  actions,
  crumbs,
}: {
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  crumbs?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        {crumbs ? <nav className="page-crumbs" aria-label="Breadcrumb">{crumbs}</nav> : null}
        <h1>{title}</h1>
        {lead ? <p>{lead}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({
  icon = "info",
  title,
  children,
  action,
  compact,
}: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <section className={`card empty${compact ? " empty-compact" : ""}`} aria-label={title}>
      <span className="empty-icon">
        <Icon name={icon} size={22} />
      </span>
      <h2>{title}</h2>
      {children ? <div className="empty-text">{children}</div> : null}
      {action ? <div className="row">{action}</div> : null}
    </section>
  );
}

export function Skeleton({ width = "100%", height = 14 }: { width?: number | string; height?: number }) {
  return <div className="skeleton" style={{ width, height }} aria-hidden="true" />;
}

export function Card({
  title,
  actions,
  children,
  pad = true,
  id,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  pad?: boolean;
  id?: string;
}) {
  return (
    <section className="card" id={id} aria-labelledby={title && id ? `${id}-title` : undefined}>
      {title ? (
        <div className="card-head">
          <h2 id={id ? `${id}-title` : undefined}>{title}</h2>
          {actions ? <div className="row">{actions}</div> : null}
        </div>
      ) : null}
      <div className={pad ? "card-body" : undefined}>{children}</div>
    </section>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}
