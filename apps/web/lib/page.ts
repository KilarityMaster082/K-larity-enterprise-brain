// Owner task: EB-23 Web UI shell — every page starts here: signed in, allowed, and scoped to one tenant.
// Tenant data is read only after the permission check passes (CLAUDE.md rule 2).
import { redirect } from "next/navigation";

import { activeMembership, getSession, type Membership, type Session } from "./auth/session";
import { tenantView, type TenantView } from "./data/store";
import { can, type Capability } from "./permissions";

interface Base {
  session: Session;
  member: Membership;
  can: (cap: Capability) => boolean;
}

export type PageContext = (Base & { allowed: true; view: TenantView }) | (Base & { allowed: false; view?: undefined });

export async function pageContext(path: string, cap: Capability): Promise<PageContext> {
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(path)}`);
  const member = activeMembership(session);
  const base: Base = { session, member, can: (c) => can(member.role, c) };
  if (!can(member.role, cap)) return { ...base, allowed: false };
  return { ...base, allowed: true, view: tenantView(member.tenantId, member.slug) };
}
