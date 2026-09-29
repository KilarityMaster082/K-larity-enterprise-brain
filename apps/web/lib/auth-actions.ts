"use server";
// Owner task: EB-23 Web UI shell — sign-in, sign-out and tenant switch (DEV session only).
// With Keycloak (OIDC + Organizations) switching tenant becomes a re-authentication into the chosen
// organization; the server never trusts a tenant id sent by the browser for data access.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { DEV_MEMBERSHIPS, DEV_USER, SESSION_COOKIE, authMode, encodeSession, getSession } from "./session";

const COOKIE_OPTS = { httpOnly: true, sameSite: "lax" as const, path: "/", secure: false, maxAge: 60 * 60 * 8 };

function safeNext(next: FormDataEntryValue | null): string {
  const n = typeof next === "string" ? next : "";
  return n.startsWith("/") && !n.startsWith("//") ? n : "/ask"; // no open redirects
}

export async function devSignIn(formData: FormData): Promise<void> {
  if (authMode() !== "dev") throw new Error("dev sign-in is disabled outside development");
  const tenantId = String(formData.get("tenantId") ?? "");
  const membership = DEV_MEMBERSHIPS.find((m) => m.tenantId === tenantId) ?? DEV_MEMBERSHIPS[0]!;
  const jar = await cookies();
  jar.set(
    SESSION_COOKIE,
    encodeSession({ user: DEV_USER, tenantId: membership.tenantId, memberships: DEV_MEMBERSHIPS }),
    COOKIE_OPTS,
  );
  redirect(safeNext(formData.get("next")));
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

export async function switchTenant(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!session.memberships.some((m) => m.tenantId === tenantId)) throw new Error("not a member of that tenant");
  const jar = await cookies();
  jar.set(SESSION_COOKIE, encodeSession({ ...session, tenantId }), COOKIE_OPTS);
  redirect("/ask"); // never keep a page from the previous tenant on screen
}
