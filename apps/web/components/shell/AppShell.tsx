"use client";
// Owner task: EB-23 Web UI shell — sidebar navigation, tenant switcher, top bar, mobile drawer.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

import { signOut, switchTenant } from "@/lib/auth-actions";
import { initials } from "@/lib/format";
import { titleFor, type NavItem } from "@/lib/nav";
import type { Membership } from "@/lib/session";

import { Icon } from "../ui/Icon";
import { ThemeToggle } from "./ThemeToggle";

interface Props {
  user: { name: string; email: string };
  active: Membership;
  memberships: Membership[];
  nav: NavItem[];
  children: ReactNode;
}

export function AppShell({ user, active, memberships, nav, children }: Props) {
  const pathname = usePathname();
  const drawer = useRef<HTMLDialogElement>(null);

  // Close the mobile drawer after navigating.
  useEffect(() => {
    drawer.current?.close();
  }, [pathname]);

  const sidebar = (
    <Sidebar user={user} active={active} memberships={memberships} nav={nav} pathname={pathname} />
  );

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {sidebar}
      <dialog ref={drawer} className="nav-drawer" aria-label="Navigation">
        {sidebar}
      </dialog>
      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="btn btn-ghost btn-icon menu-btn"
            aria-label="Open navigation"
            onClick={() => drawer.current?.showModal()}
          >
            <Icon name="menu" />
          </button>
          <span className="topbar-title">{titleFor(pathname)}</span>
          {active.isSynthetic ? <span className="badge badge-warn">Synthetic test tenant</span> : null}
          <span className="topbar-spacer" />
          <ThemeToggle />
          <details className="menu">
            <summary className="btn btn-ghost btn-icon" aria-label={`Account: ${user.name}`}>
              <span className="avatar">{initials(user.name)}</span>
            </summary>
            <div className="menu-panel right" role="menu">
              <div className="menu-label">
                {user.name}
                <br />
                {user.email}
              </div>
              <form action={signOut}>
                <button type="submit" className="menu-item" role="menuitem">
                  <Icon name="logout" size={16} /> Sign out
                </button>
              </form>
            </div>
          </details>
        </header>
        <main id="main" className="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}

function Sidebar({
  user,
  active,
  memberships,
  nav,
  pathname,
}: Omit<Props, "children"> & { pathname: string }) {
  const sections: { key: NavItem["section"]; label: string }[] = [
    { key: "brain", label: "Brain" },
    { key: "workspace", label: "Workspace" },
  ];
  return (
    <aside className="sidebar" aria-label="Primary">
      <Link href="/ask" className="brand">
        <span className="brand-mark" aria-hidden="true">
          K<span className="brand-bang">!</span>
        </span>
        <span>
          K<span className="brand-bang">!</span>larity
          <span className="brand-sub">Enterprise Brain</span>
        </span>
      </Link>

      <TenantSwitcher active={active} memberships={memberships} />

      <nav className="nav" aria-label="Main">
        {sections.map((s) => {
          const items = nav.filter((i) => i.section === s.key);
          if (!items.length) return null;
          return (
            <div key={s.key} className="nav">
              <div className="nav-section">{s.label}</div>
              {items.map((i) => {
                const current = pathname === i.href || pathname.startsWith(i.href + "/");
                return (
                  <Link key={i.href} href={i.href} className="nav-link" aria-current={current ? "page" : undefined}>
                    <Icon name={i.icon} />
                    {i.label}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        <span className="badge badge-info" title="Answers are generated only from sources you can access">
          <Icon name="shield" size={14} /> Permission-aware answers
        </span>
        <span className="visually-hidden">Signed in as {user.name}</span>
      </div>
    </aside>
  );
}

function TenantSwitcher({ active, memberships }: { active: Membership; memberships: Membership[] }) {
  return (
    <details className="menu">
      <summary className="tenant-btn" aria-label={`Workspace: ${active.name}. Switch workspace`}>
        <span className="tenant-avatar">{initials(active.name)}</span>
        <span className="tenant-name">{active.name}</span>
        <Icon name="chevronDown" size={16} />
      </summary>
      <div className="menu-panel" role="menu">
        <div className="menu-label">Switch workspace</div>
        {memberships.map((m) => (
          <form key={m.tenantId} action={switchTenant}>
            <input type="hidden" name="tenantId" value={m.tenantId} />
            <button type="submit" className="menu-item" role="menuitemradio" aria-checked={m.tenantId === active.tenantId}>
              <span className="tenant-avatar">{initials(m.name)}</span>
              <span className="tenant-name">{m.name}</span>
              {m.tenantId === active.tenantId ? <Icon name="check" size={16} /> : null}
            </button>
          </form>
        ))}
      </div>
    </details>
  );
}
