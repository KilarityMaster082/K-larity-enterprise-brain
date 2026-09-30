// Owner task: EB-100 Admin console shell — root layout for the operator console.
import "@klarity/ui/styles.css";
import "./globals.css";

import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { AdminShell } from "@/components/AdminShell";
import { getTenant, listTenants } from "@/lib/data";
import { openDeadLetters } from "@/lib/ops";
import { opLauncher, opRail } from "@/lib/screens";
import { adminAuthMode, getOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "K!larity operator console", template: "%s · K!larity ops" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function Layout({ children }: { children: ReactNode }) {
  const s = await getOperator();
  const imp = s?.impersonating;
  const tenant = imp ? getTenant(imp.tenantId) : undefined;
  return (
    <html lang="en-IN" data-skin="eb" data-theme="light">
      <body>
        {s ? (
          <AdminShell
            operator={{ name: s.operator.name, email: s.operator.email }}
            rail={opRail({ "/dead-letter": listTenants().reduce((n, t) => n + openDeadLetters(t.tenantId), 0) })}
            launcher={opLauncher()}
            devMode={adminAuthMode() === "dev"}
            impersonating={imp && tenant ? { tenantName: tenant.name, reason: imp.reason, expiresAt: imp.expiresAt } : undefined}
          >
            {children}
          </AdminShell>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
