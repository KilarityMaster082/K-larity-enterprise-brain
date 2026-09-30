// Owner task: EB-23 Web UI shell — root layout: signed-in pages get the Enterprise Brain frame (rail, top bar,
// overlays), /login renders bare. The handoff design is a light, pastel "bento" skin (data-skin="eb").
import "@klarity/ui/styles.css";

import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { AppShell } from "@/components/shell/AppShell";
import { authMode } from "@/lib/auth/config";
import { activeMembership, getSession } from "@/lib/auth/session";
import { tenantView } from "@/lib/data/store";
import { railFor } from "@/lib/nav";
import { can } from "@/lib/permissions";
import { launcherFor } from "@/lib/screens";

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
  themeColor: "#1b1b1b",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  const active = session ? activeMembership(session) : null;
  let counts: Record<string, number> = {};
  if (active && can(active.role, "approvals.view")) {
    const v = tenantView(active.tenantId, active.slug);
    counts = {
      "/approvals": v.approvals.filter((a) => a.status === "pending").length,
      "/decisions": v.data.decisions.filter((d) => d.status === "proposed").length,
    };
  }
  return (
    <html lang="en-IN" data-skin="eb" data-theme="light">
      <body>
        {session && active ? (
          <AppShell
            user={{ name: session.user.name, email: session.user.email }}
            active={active}
            memberships={session.memberships}
            rail={railFor(active.role, counts)}
            launcher={launcherFor((c) => can(active.role, c))}
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
