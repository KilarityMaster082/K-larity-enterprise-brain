"use client";
// Owner task: EB-100 Admin console shell — the operator frame (screens 46–54): the Enterprise Brain rail and top bar shared
// with apps/web, plus a persistent impersonation banner with the reason, time left and an Exit button on every page.
import { EbShell, Icon, ToastProvider, initials, useToast, type LauncherGroup, type RailItem } from "@klarity/ui";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";

import { operatorSignOut, stopImpersonationAction } from "@/lib/actions";

export interface ShellImpersonation {
  tenantName: string;
  reason: string;
  expiresAt: string;
}

type ShellLink = (p: { href: string; className?: string; children: ReactNode; "aria-current"?: "page"; "aria-label"?: string; title?: string }) => ReactNode;
const ShellLinkImpl: ShellLink = ({ href, className, children, ...rest }) => (
  <Link href={href} className={className} {...rest}>
    {children}
  </Link>
);

export function AdminShell({ operator, impersonating, rail, launcher, devMode, children }: { operator: { name: string; email: string }; impersonating?: ShellImpersonation; rail: RailItem[]; launcher: LauncherGroup[]; devMode: boolean; children: ReactNode }) {
  const pathname = usePathname();
  const account = (
    <details className="eb-menu">
      <summary className="eb-avatar" aria-label={`Operator: ${operator.name}`} style={{ listStyle: "none", cursor: "pointer" }}>
        {initials(operator.name)}
      </summary>
      <div className="eb-menu-pop left" style={{ position: "fixed", left: 66, bottom: 24, top: "auto" }} role="menu">
        <div className="eb-menu-label">
          {operator.name}
          <br />
          {operator.email}
          <br />
          K!larity staff
        </div>
        <form action={operatorSignOut}>
          <button type="submit" className="eb-menu-item" role="menuitem">
            <Icon name="logout" size={14} /> Sign out
          </button>
        </form>
      </div>
    </details>
  );
  const tenant = impersonating ? (
    <span className="eb-tenant" role="status" style={{ cursor: "default" }}>
      <Icon name="mask" size={12} />
      <span className="nm">Viewing {impersonating.tenantName}</span>
    </span>
  ) : (
    <span className="eb-tenant" style={{ cursor: "default", opacity: 0.7 }}>
      <span className="nm">No tenant in view</span>
    </span>
  );
  return (
    <ToastProvider>
      <EbShell
        pathname={pathname}
        brandHref="/tenants"
        routeLabel={pathname}
        rail={rail}
        launcher={launcher}
        tenant={tenant}
        account={account}
        Link={ShellLinkImpl}
        banner={
          <>
            {devMode ? (
              <div className="eb-dev-banner" role="note">
                Development data: the control-plane API is not connected, so this console shows a seeded fleet that resets when the server restarts.
              </div>
            ) : null}
            {impersonating ? <ImpersonationBanner {...impersonating} /> : null}
          </>
        }
      >
        {children}
      </EbShell>
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
    <div className="eb-imp-banner" role="region" aria-label="Impersonation in progress">
      <Icon name="mask" size={14} />
      <span>
        Viewing <strong>{tenantName}</strong> as an operator · reason: “{reason}” · {Math.ceil(left / 60_000)} min left · every query is audited
      </span>
      <span style={{ flex: 1 }} />
      <button
        type="button"
        className="eb-pill"
        data-tone="black"
        data-size="sm"
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
