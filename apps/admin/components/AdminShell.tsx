"use client";
// Owner task: EB-100 Admin console shell — operator frame: logo, navigation, and a persistent impersonation
// banner with the reason, time left and an Exit button on every page.
import { Badge, Icon, initials, Logo, ShellFrame, ToastProvider, useToast, type IconName } from "@klarity/ui";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";

import { operatorSignOut, stopImpersonationAction } from "@/lib/actions";

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/tenants", label: "Tenants", icon: "building" },
  { href: "/sources-health", label: "Sources health", icon: "pulse" },
  { href: "/retrieval", label: "Retrieval console", icon: "search" },
  { href: "/audit", label: "Audit log", icon: "audit" },
];

export interface ShellImpersonation {
  tenantName: string;
  reason: string;
  expiresAt: string;
}

export function AdminShell({ operator, impersonating, children }: { operator: { name: string; email: string }; impersonating?: ShellImpersonation; children: ReactNode }) {
  const pathname = usePathname();
  const title = NAV.find((n) => pathname.startsWith(n.href))?.label ?? "Operator console";
  const sidebar = (
    <>
      <Link href="/tenants" className="logo-link" aria-label="K!larity operator console — Tenants">
        <Logo width={128} caption="Operator console" />
      </Link>
      <nav className="nav" aria-label="Main">
        <div className="nav-section">Operate</div>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="nav-link" aria-current={pathname.startsWith(n.href) ? "page" : undefined}>
            <Icon name={n.icon} />
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="sidebar-foot">
        <Badge tone="warn" icon="shield">
          K!larity staff only
        </Badge>
      </div>
    </>
  );
  return (
    <ToastProvider>
      <ShellFrame
        routeKey={pathname}
        sidebar={sidebar}
        title={title}
        banner={impersonating ? <ImpersonationBanner {...impersonating} /> : undefined}
        topbarRight={
          <details className="menu">
            <summary className="btn btn-ghost btn-icon" aria-label={`Operator: ${operator.name}`}>
              <span className="avatar">{initials(operator.name)}</span>
            </summary>
            <div className="menu-panel right" role="menu">
              <div className="menu-label">
                {operator.name}
                <br />
                {operator.email}
              </div>
              <form action={operatorSignOut}>
                <button type="submit" className="menu-item" role="menuitem">
                  <Icon name="logout" size={16} /> Sign out
                </button>
              </form>
            </div>
          </details>
        }
      >
        {children}
      </ShellFrame>
    </ToastProvider>
  );
}

function ImpersonationBanner({ tenantName, reason, expiresAt }: ShellImpersonation) {
  const [left, setLeft] = useState(() => Math.max(0, new Date(expiresAt).getTime() - Date.now()));
  const [busy, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  useEffect(() => {
    const t = setInterval(() => {
      const ms = Math.max(0, new Date(expiresAt).getTime() - Date.now());
      setLeft(ms);
      if (ms === 0) router.refresh();
    }, 15_000);
    return () => clearInterval(t);
  }, [expiresAt, router]);
  return (
    <div className="banner banner-impersonate" role="region" aria-label="Impersonation in progress">
      <Icon name="mask" />
      <span>
        Viewing <strong>{tenantName}</strong> as an operator · reason: “{reason}” · {Math.ceil(left / 60_000)} min left · every query is audited
      </span>
      <span className="topbar-spacer" />
      <button
        type="button"
        className="btn btn-dark btn-sm"
        disabled={busy}
        onClick={() =>
          start(async () => {
            const r = await stopImpersonationAction();
            toast(r.ok ? (r.message ?? "Stopped.") : r.error, r.ok ? "default" : "danger");
            router.refresh();
          })
        }
      >
        Exit
      </button>
    </div>
  );
}
