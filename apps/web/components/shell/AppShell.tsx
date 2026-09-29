"use client";
// Owner task: EB-23 Web UI shell — the Brain's frame: logo, workspace switcher, role-filtered navigation,
// search (⌘K), theme and account menu. Built on @klarity/ui ShellFrame.
import { Badge, Icon, Kbd, Logo, ShellFrame, ToastProvider, initials } from "@klarity/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { signOut, switchTenant } from "@/lib/auth-actions";
import type { Membership } from "@/lib/auth/session";
import { titleFor, type NavItem } from "@/lib/nav";
import { ROLE_LABEL } from "@/lib/permissions";

import { CommandPalette } from "./CommandPalette";
import { ThemeToggle } from "./ThemeToggle";

interface Props {
  user: { name: string; email: string };
  active: Membership;
  memberships: Membership[];
  nav: NavItem[];
  counts: Partial<Record<string, number>>;
  devMode: boolean;
  children: ReactNode;
}

export function AppShell({ user, active, memberships, nav, counts, devMode, children }: Props) {
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sections: { key: NavItem["section"]; label: string }[] = [
    { key: "brain", label: "Brain" },
    { key: "workspace", label: "Workspace" },
  ];

  const sidebar = (
    <>
      <Link href="/ask" className="logo-link" aria-label="K!larity Enterprise Brain — Ask Brain">
        <Logo width={128} caption="Enterprise Brain" />
      </Link>

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

      <nav className="nav" aria-label="Main">
        {sections.map((s) => {
          const items = nav.filter((i) => i.section === s.key);
          if (!items.length) return null;
          return (
            <div key={s.key} className="nav">
              <div className="nav-section">{s.label}</div>
              {items.map((i) => {
                const current = pathname === i.href || pathname.startsWith(i.href + "/");
                const count = counts[i.href];
                return (
                  <Link key={i.href} href={i.href} className="nav-link" aria-current={current ? "page" : undefined}>
                    <Icon name={i.icon} />
                    {i.label}
                    {count ? (
                      <span className="nav-count" aria-label={`${count} waiting`}>
                        {count}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        <Badge tone="info" icon="shield" title="Answers use only sources you can access">
          Permission-aware answers
        </Badge>
        {devMode ? <Badge tone="warn">Development sign-in</Badge> : null}
      </div>
    </>
  );

  return (
    <ToastProvider>
      <ShellFrame
        routeKey={pathname}
        sidebar={sidebar}
        title={titleFor(pathname)}
        topbarExtra={active.isSynthetic ? <Badge tone="warn">Synthetic test tenant</Badge> : null}
        topbarRight={
          <>
            <button type="button" className="search-trigger" onClick={() => setPaletteOpen(true)} aria-label="Search and jump (Ctrl K)">
              <Icon name="search" size={16} />
              <span className="search-label">Search or jump to…</span>
              <Kbd>⌘K</Kbd>
            </button>
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
                  <br />
                  {ROLE_LABEL[active.role]} · {active.name}
                </div>
                <form action={signOut}>
                  <button type="submit" className="menu-item" role="menuitem">
                    <Icon name="logout" size={16} /> Sign out
                  </button>
                </form>
              </div>
            </details>
          </>
        }
      >
        {children}
      </ShellFrame>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} nav={nav} />
    </ToastProvider>
  );
}
