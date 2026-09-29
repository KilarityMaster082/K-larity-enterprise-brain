// Owner task: EB-23 Web UI shell — root layout: signed-in pages get the app shell, /login renders bare.
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { AppShell } from "@/components/shell/AppShell";
import { navFor } from "@/lib/nav";
import { activeMembership, getSession } from "@/lib/session";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";

import "./globals.css";

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
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1020" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  const active = session ? activeMembership(session) : null;
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value); // undefined = follow the OS
  return (
    <html lang="en-IN" data-theme={theme}>
      <body>
        {session && active ? (
          <AppShell
            user={{ name: session.user.name, email: session.user.email }}
            active={active}
            memberships={session.memberships}
            nav={navFor(active.role)}
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
