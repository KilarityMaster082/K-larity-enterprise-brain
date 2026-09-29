// Owner task: EB-100 Admin console shell — operator sessions. Separate cookie name, separate signing secret
// and separate port from the Brain, so an operator session can never be used in a tenant app or vice versa.
// Production: Keycloak operator realm with the `klarity-operator` role (not wired yet → sign-in disabled).
import { signValue, verifyValue } from "@klarity/web-auth";
import { cookies } from "next/headers";

export const OP_COOKIE = "kb_op_session";
const TTL = 4 * 60 * 60; // operators re-authenticate every 4 hours
export const IMPERSONATION_MINUTES = 30;

export interface Impersonation {
  tenantId: string;
  reason: string;
  startedAt: string;
  expiresAt: string;
}

export interface OperatorSession {
  v: 1;
  operator: { id: string; name: string; email: string };
  impersonating?: Impersonation;
  exp: number;
}

export function adminAuthMode(): "dev" | "none" {
  return process.env.NODE_ENV === "production" ? "none" : "dev";
}

function secret(): string {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") throw new Error("ADMIN_SESSION_SECRET (32+ characters) is required in production");
  return "development-only-operator-secret-not-for-production";
}

const COOKIE = { httpOnly: true, sameSite: "strict" as const, path: "/", secure: process.env.NODE_ENV === "production" };

export async function getOperator(): Promise<OperatorSession | null> {
  if (adminAuthMode() === "none") return null;
  const jar = await cookies();
  const s = await verifyValue<OperatorSession>(jar.get(OP_COOKIE)?.value, secret());
  if (!s || s.v !== 1 || s.exp * 1000 < Date.now()) return null;
  if (s.impersonating && new Date(s.impersonating.expiresAt).getTime() < Date.now()) return { ...s, impersonating: undefined };
  return s;
}

export async function writeOperator(s: Omit<OperatorSession, "v" | "exp"> & { exp?: number }): Promise<void> {
  const jar = await cookies();
  const full: OperatorSession = { ...s, v: 1, exp: s.exp ?? Math.floor(Date.now() / 1000) + TTL };
  jar.set(OP_COOKIE, await signValue(full, secret()), { ...COOKIE, maxAge: Math.max(0, full.exp - Math.floor(Date.now() / 1000)) });
}

export async function clearOperator(): Promise<void> {
  (await cookies()).delete(OP_COOKIE);
}
