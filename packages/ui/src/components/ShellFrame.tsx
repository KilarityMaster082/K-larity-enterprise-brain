"use client";
// Owner task: EB-91 UI design system — app frame shared by apps/web and apps/admin: sticky sidebar on desktop,
// the same sidebar in a <dialog> drawer on mobile, sticky top bar and an optional banner (e.g. impersonation).
import { useEffect, useRef, type ReactNode } from "react";

import { Icon } from "./Icon";

export function ShellFrame({
  sidebar,
  title,
  topbarExtra,
  topbarRight,
  banner,
  routeKey,
  children,
}: {
  sidebar: ReactNode;
  title: ReactNode;
  topbarExtra?: ReactNode;
  topbarRight?: ReactNode;
  banner?: ReactNode;
  /** Current route; the mobile drawer closes when it changes. */
  routeKey: string;
  children: ReactNode;
}) {
  const drawer = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    drawer.current?.close();
  }, [routeKey]);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Primary">
        {sidebar}
      </aside>
      <dialog ref={drawer} className="nav-drawer" aria-label="Navigation">
        <aside className="sidebar" aria-label="Primary (menu)">
          {sidebar}
        </aside>
      </dialog>
      <div className="main">
        {banner}
        <header className="topbar">
          <button
            type="button"
            className="btn btn-ghost btn-icon menu-btn"
            aria-label="Open navigation"
            onClick={() => drawer.current?.showModal()}
          >
            <Icon name="menu" />
          </button>
          <span className="topbar-title">{title}</span>
          {topbarExtra}
          <span className="topbar-spacer" />
          {topbarRight}
        </header>
        <main id="main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
