// Owner task: EB-92 Web auth — turn the identity provider's claims into tenant memberships.
// Tenant = Keycloak Organization alias → registry (never a client-supplied value). Role per tenant comes from
// the `klarity_roles` claim ({ "<org alias>": "<role>" }) until apps/api serves the users table; default member.
import type { Role } from "../data/types";
import { tenantByOrg } from "../tenants";
import { organizationsOf, type IdTokenClaims } from "@klarity/web-auth";
import type { Membership } from "./session";

const ROLES: Role[] = ["owner", "admin", "member", "viewer", "guest"];

export function membershipsFromClaims(claims: IdTokenClaims): Membership[] {
  const roles = (claims.klarity_roles && typeof claims.klarity_roles === "object" ? claims.klarity_roles : {}) as Record<string, unknown>;
  const out: Membership[] = [];
  for (const alias of organizationsOf(claims)) {
    const t = tenantByOrg(alias);
    if (!t || t.status !== "active") continue; // unknown or suspended organisations grant nothing
    const r = roles[alias];
    const role: Role = typeof r === "string" && (ROLES as string[]).includes(r) ? (r as Role) : "member";
    out.push({ tenantId: t.tenantId, slug: t.slug, name: t.name, role, isSynthetic: t.isSynthetic });
  }
  return out;
}
