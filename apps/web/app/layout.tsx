// Owner task: EB-23 Web UI shell — root layout: signed-in pages get the app shell, /login renders bare.
import "@klarity/ui/styles.css";
import "./globals.css";

import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { AppShell } from "@/components/shell/AppShell";
import { authMode } from "@/lib/auth/config";
import { activeMembership, getSession } from "@/lib/auth/session";
import { tenantView } from "@/lib/data/store";
import { navFor } from "@/lib/nav";
import { can } from "@/lib/permissions";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";

// Every page depends on who is signed in and which tenant is active: never pre-render or cache them.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "K!larity Enterprise Brain", template: "%s · K!larity" },
  description: "Evidence-backed answers from your company's email, chats, documents and ledgers.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f4" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0c0e" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  const active = session ? activeMembership(session) : null;
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value); // undefined = follow the OS
  let counts: Record<string, number> = {};
  if (active && can(active.role, "approvals.view")) {
    const v = tenantView(active.tenantId, active.slug);
    counts = {
      "/approvals": v.approvals.filter((a) => a.status === "pending").length,
      "/decisions": v.data.decisions.filter((d) => d.status === "proposed").length,
    };
  }
  return (
    <html lang="en-IN" data-theme={theme}>
      <body>
        {session && active ? (
          <AppShell
            user={{ name: session.user.name, email: session.user.email }}
            active={active}
            memberships={session.memberships}
            nav={navFor(active.role)}
            counts={counts}
            devMode={authMode() === "dev"}
          >
            {children}
          </AppShell>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
