"use server";
// Owner task: EB-92 Web auth — sign-in (development), sign-out and workspace switch.
// With Keycloak, switching workspace is a new sign-in into that organization; in development the signed
// session simply changes its active tenant, but only to a tenant it is already a member of.
import { redirect } from "next/navigation";

import { authMode, oidcConfig } from "./auth/config";
import { logoutUrl } from "./auth/oidc";
import { safeNext } from "@klarity/web-auth";
import { clearSession, getSession, writeSession, type Membership } from "./auth/session";
import type { Role } from "./data/types";
import { ROLES } from "./permissions";
import { TENANTS } from "./tenants";

export async function devSignIn(formData: FormData): Promise<void> {
  if (authMode() !== "dev") throw new Error("development sign-in is disabled");
  const tenantId = String(formData.get("tenantId") ?? "");
  const roleIn = String(formData.get("role") ?? "admin");
  const role: Role = (ROLES as string[]).includes(roleIn) ? (roleIn as Role) : "admin";
  const memberships: Membership[] = TENANTS.filter((t) => t.status === "active").map((t) => ({
    tenantId: t.tenantId,
    slug: t.slug,
    name: t.name,
    role: t.tenantId === tenantId ? role : t.isSynthetic ? "owner" : "admin",
    isSynthetic: t.isSynthetic,
  }));
  const active = memberships.find((m) => m.tenantId === tenantId) ?? memberships[0]!;
  await writeSession({
    mode: "dev",
    user: { id: "dev-user", name: "Demo user", email: "demo.user@example.com" },
    tenantId: active.tenantId,
    memberships,
  });
  redirect(safeNext(formData.get("next")));
}

export async function signOut(): Promise<void> {
  await clearSession();
  const cfg = oidcConfig();
  const url = cfg ? await logoutUrl(cfg) : null;
  redirect(url ?? "/login");
}

export async function switchTenant(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");
  const tenantId = String(formData.get("tenantId") ?? "");
  const target = session.memberships.find((m) => m.tenantId === tenantId);
  if (!target) throw new Error("not a member of that workspace");
  if (session.mode === "oidc") redirect(`/api/auth/login?org=${encodeURIComponent(target.slug)}&next=/ask`);
  await writeSession({ mode: session.mode, user: session.user, tenantId, memberships: session.memberships });
  redirect("/ask"); // never keep a page from the previous workspace on screen
}

/** Development only: look at the app as another role without signing in again. Production ignores it (403-equivalent). */
export async function previewRole(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.mode !== "dev" || authMode() !== "dev") throw new Error("role preview is a development feature");
  const roleIn = String(formData.get("role") ?? "");
  if (!(ROLES as string[]).includes(roleIn)) throw new Error("unknown role");
  const memberships = session.memberships.map((m) => (m.tenantId === session.tenantId ? { ...m, role: roleIn as Role } : m));
  await writeSession({ mode: session.mode, user: session.user, tenantId: session.tenantId, memberships });
  redirect("/ask");
}
