"use client";
// Owner task: EB-23 Web UI shell — the Enterprise Brain frame shared by apps/web and apps/admin: icon rail,
// top bar (route pill, period control, workspace switcher, ⌘K), screen launcher and content column.
// The app supplies the links; this component never decides who may see what (the server filters `rail` and
// `launcher` by role, and every page checks again).
import type { ReactNode } from "react";

import { Icon, type IconName } from "../components/Icon";
import { LogoMark } from "../components/Logo";

export interface RailItem {
  href: string;
  label: string;
  icon: IconName;
  badge?: number;
  /** Extra path prefixes that keep this item highlighted (e.g. /settings/members under /settings/sources). */
  match?: string[];
}

export interface LauncherGroup {
  label: string;
  items: { n?: number; title: string; href: string; route?: string }[];
}

export interface PeriodOption {
  key: string;
  label: string;
  href: string;
}

function isCurrent(pathname: string, item: RailItem): boolean {
  const prefixes = [item.href, ...(item.match ?? [])];
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function EbShell({
  pathname,
  brandHref,
  routeLabel,
  rail,
  launcher,
  period,
  tenant,
  account,
  onOpenPalette,
  banner,
  Link,
  children,
}: {
  pathname: string;
  brandHref: string;
  /** Mono route pill in the top bar, e.g. "/ask". */
  routeLabel: string;
  rail: RailItem[];
  launcher: LauncherGroup[];
  period?: { options: PeriodOption[]; current: string };
  tenant?: ReactNode;
  account: ReactNode;
  onOpenPalette?: () => void;
  banner?: ReactNode;
  /** The app's router link (next/link), so client navigation stays in the app. */
  Link: (props: { href: string; className?: string; children: ReactNode; "aria-current"?: "page"; "aria-label"?: string; title?: string }) => ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="eb-page">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="eb-frame">
        <nav className="eb-rail" aria-label="Primary">
          <Link href={brandHref} className="eb-rail-mark-link" aria-label="K!larity Enterprise Brain home">
            <span className="eb-rail-mark">
              <LogoMark size={22} />
            </span>
          </Link>
          {rail.map((r) => (
            <Link key={r.href} href={r.href} className="eb-rail-item" aria-current={isCurrent(pathname, r) ? "page" : undefined} aria-label={r.badge ? `${r.label} (${r.badge} waiting)` : r.label} title={r.label}>
              <Icon name={r.icon} size={14} />
              {r.badge ? <span className="eb-rail-badge" aria-hidden="true">{r.badge}</span> : null}
            </Link>
          ))}
          <details className="eb-menu">
            <summary className="eb-rail-item" aria-label="All screens" title="All screens" style={{ listStyle: "none" }}>
              <Icon name="apps" size={14} />
            </summary>
            <div className="eb-menu-pop left" style={{ position: "fixed", left: 66, top: 24, maxHeight: "calc(100dvh - 48px)", width: 280 }}>
              {launcher.map((g) => (
                <div key={g.label}>
                  <div className="eb-menu-label">{g.label}</div>
                  {g.items.map((it) => (
                    <Link key={it.href + it.title} href={it.href} className="eb-menu-item" aria-current={pathname === it.href ? "page" : undefined}>
                      {it.n ? <span className="n">{it.n}</span> : null}
                      <span className="eb-grow">{it.title}</span>
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          </details>
          <span className="eb-rail-spacer" />
          {account}
        </nav>

        <div className="eb-col">
          {banner}
          <header className="eb-topbar">
            <span className="eb-route">{routeLabel}</span>
            {period ? (
              <nav className="eb-period" aria-label="Reporting period">
                <ul>
                  {period.options.map((o) => (
                    <li key={o.key}>
                      <Link href={o.href} aria-current={o.key === period.current ? ("page" as const) : undefined} className={o.key === period.current ? "on" : undefined}>
                        {o.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : (
              <span className="eb-period" />
            )}
            {tenant}
            <button type="button" className="eb-kbtn" onClick={onOpenPalette} aria-label="Search and jump (Ctrl or Command K)" title="Search and jump">
              ⌘K
            </button>
          </header>
          <main id="main" tabIndex={-1} className="eb-main">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
