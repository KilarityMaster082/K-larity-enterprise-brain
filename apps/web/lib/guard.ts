// Owner task: EB-23 Web UI shell — server-side page guard: signed in, and role allowed for the route.
import { redirect } from "next/navigation";

import { NAV } from "./nav";
import { activeMembership, getSession, type Membership, type Session } from "./session";

export async function requirePage(href: string): Promise<{ session: Session; member: Membership; allowed: boolean }> {
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(href)}`);
  const member = activeMembership(session);
  const item = NAV.find((n) => n.href === href);
  const allowed = !item?.roles || item.roles.includes(member.role);
  return { session, member, allowed };
}
