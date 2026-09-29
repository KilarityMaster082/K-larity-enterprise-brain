// Owner task: EB-100 Admin console shell — root layout for the operator console.
import "@klarity/ui/styles.css";
import "./globals.css";

import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { AdminShell } from "@/components/AdminShell";
import { getTenant } from "@/lib/data";
import { getOperator } from "@/lib/session";

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
    <html lang="en-IN">
      <body>
        {s ? (
          <AdminShell
            operator={{ name: s.operator.name, email: s.operator.email }}
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
