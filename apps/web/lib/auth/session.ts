// Owner task: EB-92 Web auth — the signed session cookie and who is signed in.
// The active tenant is always one of the memberships the identity provider (or the dev sign-in) granted;
// the browser can never pick a tenant it is not a member of, and the cookie cannot be edited (HMAC).
import { cookies } from "next/headers";

import type { Role } from "../data/types";
import { tenantById } from "../tenants";
import { SESSION_TTL_SECONDS, authMode, sessionSecret, type AuthMode } from "./config";
import { signValue, verifyValue } from "@klarity/web-auth";

export interface Membership {
  tenantId: string;
  slug: string;
  name: string;
  role: Role;
  isSynthetic?: boolean;
}

export interface Session {
  v: 1;
  mode: Exclude<AuthMode, "none">;
  user: { id: string; name: string; email: string };
  tenantId: string;
  memberships: Membership[];
  exp: number; // unix seconds
}

export const SESSION_COOKIE = "kb_session";

const COOKIE = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
};

export async function readSession(raw: string | undefined, now = Date.now()): Promise<Session | null> {
  const s = await verifyValue<Session>(raw, sessionSecret());
  if (!s || s.v !== 1 || s.exp * 1000 < now) return null;
  const mode = authMode();
  if (mode === "none" || s.mode !== mode) return null; // a dev session is worthless once OIDC is configured
  if (!s.memberships.some((m) => m.tenantId === s.tenantId)) return null;
  const t = tenantById(s.tenantId);
  if (!t || t.status !== "active") return null; // suspended tenants lose access immediately
  return s;
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  return readSession(jar.get(SESSION_COOKIE)?.value);
}

export async function writeSession(s: Omit<Session, "v" | "exp">): Promise<void> {
  const jar = await cookies();
  const full: Session = { ...s, v: 1, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  jar.set(SESSION_COOKIE, await signValue(full, sessionSecret()), { ...COOKIE, maxAge: SESSION_TTL_SECONDS });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export function activeMembership(s: Session): Membership {
  const m = s.memberships.find((x) => x.tenantId === s.tenantId);
  if (!m) throw new Error("active tenant is not a membership");
  return m;
}
