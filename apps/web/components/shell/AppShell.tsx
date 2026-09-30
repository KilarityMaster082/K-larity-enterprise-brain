"use client";
// Owner task: EB-23 Web UI shell — the Brain's frame (screens 1–45): icon rail, top bar with workspace switcher and
// ⌘K, the screen launcher, account menu (with development-only role preview) and the overlay host that opens
// the Evidence Side-Sheet, file viewers, agent run inspector and email composer over whatever page is showing.
import { EbShell, Icon, ToastProvider, initials, type LauncherGroup, type RailItem } from "@klarity/ui";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";

import { previewRole, signOut, switchTenant } from "@/lib/auth-actions";
import type { Membership } from "@/lib/auth/session";
import { PERIODS, PERIOD_ROUTES, parsePeriod } from "@/lib/period";
import { ROLES, ROLE_LABEL } from "@/lib/permissions";
import type { Role } from "@/lib/data/types";

import { OverlayHost } from "../overlays/OverlayHost";
import { TenantProvider } from "./TenantContext";
import { CommandPalette } from "./CommandPalette";

interface Props {
  user: { name: string; email: string };
  active: Membership;
  memberships: Membership[];
  rail: RailItem[];
  launcher: LauncherGroup[];
  devMode: boolean;
  children: ReactNode;
}

type ShellLink = (p: { href: string; className?: string; children: ReactNode; "aria-current"?: "page"; "aria-label"?: string; title?: string }) => ReactNode;

const ShellLinkImpl: ShellLink = ({ href, className, children, ...rest }) => (
  <Link href={href} className={className} {...rest}>
    {children}
  </Link>
);

export function AppShell({ user, active, memberships, rail, launcher, devMode, children }: Props) {
  const pathname = usePathname();
  const search = useSearchParams();
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

  const usesPeriod = PERIOD_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"));
  const current = parsePeriod(search.get("period") ?? undefined);
  const periodOptions = PERIODS.map((p) => {
    const q = new URLSearchParams(search.toString());
    q.set("period", p.key);
    return { key: p.key, label: p.label, href: `${pathname}?${q.toString()}` };
  });

  const tenant = (
    <details className="eb-menu">
      <summary className="eb-tenant" aria-label={`Workspace: ${active.name}. Switch workspace`}>
        <span className="nm">{active.name}</span>
        {active.isSynthetic ? <span className="eb-pill" data-tone="cream" data-size="sm">Synthetic</span> : null}
        <Icon name="chevronDown" size={12} />
      </summary>
      <div className="eb-menu-pop" role="menu">
        <div className="eb-menu-label">Switch workspace</div>
        {memberships.map((m) => (
          <form key={m.tenantId} action={switchTenant}>
            <input type="hidden" name="tenantId" value={m.tenantId} />
            <button type="submit" className="eb-menu-item" role="menuitemradio" aria-checked={m.tenantId === active.tenantId} aria-current={m.tenantId === active.tenantId ? "page" : undefined}>
              <span className="eb-avatar eb-avatar-sm" style={{ background: m.isSynthetic ? "#e3e3e3" : "var(--eb-black)", color: m.isSynthetic ? "var(--eb-black)" : "#fff" }}>
                {initials(m.name)}
              </span>
              <span className="eb-grow">{m.name}</span>
              {m.isSynthetic ? <span className="eb-pill" data-tone="cream" data-size="sm">Synthetic tenant</span> : null}
              {m.tenantId === active.tenantId ? <Icon name="check" size={14} /> : null}
            </button>
          </form>
        ))}
      </div>
    </details>
  );

  const account = (
    <details className="eb-menu">
      <summary className="eb-avatar" aria-label={`Account: ${user.name}`} style={{ listStyle: "none", cursor: "pointer" }}>
        {initials(user.name)}
      </summary>
      <div className="eb-menu-pop left" style={{ position: "fixed", left: 66, bottom: 24, top: "auto" }} role="menu">
        <div className="eb-menu-label">
          {user.name}
          <br />
          {user.email}
          <br />
          {ROLE_LABEL[active.role]} · {active.name}
        </div>
        {devMode ? (
          <form action={previewRole} aria-label="Preview another role (development only)">
            <div className="eb-menu-label">Preview role (development)</div>
            {ROLES.map((r: Role) => (
              <button key={r} type="submit" name="role" value={r} className="eb-menu-item" role="menuitemradio" aria-checked={r === active.role}>
                <span className="eb-grow">{ROLE_LABEL[r]}</span>
                {r === active.role ? <Icon name="check" size={14} /> : null}
              </button>
            ))}
          </form>
        ) : null}
        <form action={signOut}>
          <button type="submit" className="eb-menu-item" role="menuitem">
            <Icon name="logout" size={14} /> Sign out
          </button>
        </form>
      </div>
    </details>
  );

  return (
    <ToastProvider>
      <TenantProvider tenantId={active.tenantId}>
      <EbShell
        pathname={pathname}
        brandHref="/ask"
        routeLabel={pathname}
        rail={rail}
        launcher={launcher}
        period={usesPeriod ? { options: periodOptions, current } : undefined}
        tenant={tenant}
        account={account}
        onOpenPalette={() => setPaletteOpen(true)}
        Link={ShellLinkImpl}
        banner={devMode ? <div className="eb-dev-banner" role="note">Development sign-in: data is demo data and resets when the server restarts.</div> : undefined}
      >
        {children}
      </EbShell>
      <Suspense fallback={null}>
        <OverlayHost tenantId={active.tenantId} />
      </Suspense>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} launcher={launcher} />
      </TenantProvider>
    </ToastProvider>
  );
}
