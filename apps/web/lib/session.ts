// Owner task: EB-23 Web UI shell — session and tenant membership for the web app.
//
// Production auth is Keycloak OIDC with Organizations (ADR-013): the tenant comes from the token's
// organization claim and is never chosen by the client. Until the Keycloak task lands, `next dev` uses a
// DEV session cookie so the UI can be built and reviewed. A production build refuses the dev session.
// Server-only: importing next/headers makes this module unusable from client components.
import { cookies } from "next/headers";

export type Role = "owner" | "partner" | "member";

export interface Membership {
  tenantId: string;
  slug: string;
  name: string;
  role: Role;
  isSynthetic?: boolean;
}

export interface Session {
  user: { id: string; name: string; email: string };
  tenantId: string;
  memberships: Membership[];
}

export const SESSION_COOKIE = "kb_dev_session";

export type AuthMode = "dev" | "oidc";

export function authMode(): AuthMode {
  return process.env.NODE_ENV === "production" ? "oidc" : "dev";
}

// Mirrors services/control-plane/control_plane/seed.py (EB-85 day-one tenants).
export const DEV_MEMBERSHIPS: Membership[] = [
  { tenantId: "0fdc5142-8c25-41c5-aab4-0a88db52a5bf", slug: "studio8", name: "Studio 8 Hats", role: "partner" },
  {
    tenantId: "1bae9ff8-abf9-44bf-9b17-a5cb2c83d71b",
    slug: "synthetic-canary",
    name: "Synthetic canary",
    role: "owner",
    isSynthetic: true,
  },
];

export const DEV_USER = { id: "dev-user", name: "Demo Partner", email: "demo.partner@example.com" };

export function encodeSession(s: Session): string {
  return Buffer.from(JSON.stringify(s), "utf8").toString("base64url");
}

export function decodeSession(raw: string | undefined): Session | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Session;
    // The active tenant must be one of the user's memberships.
    if (!s?.user?.id || !Array.isArray(s.memberships) || !s.memberships.some((m) => m.tenantId === s.tenantId)) {
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  if (authMode() !== "dev") return null; // OIDC not wired yet: nobody is signed in.
  const jar = await cookies();
  return decodeSession(jar.get(SESSION_COOKIE)?.value);
}

export function activeMembership(s: Session): Membership {
  const m = s.memberships.find((x) => x.tenantId === s.tenantId);
  if (!m) throw new Error("active tenant is not a membership");
  return m;
}
