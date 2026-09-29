// Owner task: EB-23 Web UI shell — navigation. Items are filtered by capability on the server; pages check
// again, so hiding an item is a convenience, never the protection.
import type { IconName } from "@klarity/ui";

import type { Role } from "./data/types";
import { can, type Capability } from "./permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  section: "brain" | "workspace";
  cap: Capability;
}

export const NAV: NavItem[] = [
  { href: "/ask", label: "Ask Brain", icon: "ask", section: "brain", cap: "ask" },
  { href: "/projects", label: "Projects", icon: "projects", section: "brain", cap: "projects.view" },
  { href: "/finance", label: "Finance", icon: "finance", section: "brain", cap: "finance.view" },
  { href: "/decisions", label: "Decisions", icon: "decisions", section: "brain", cap: "decisions.view" },
  { href: "/documents", label: "Documents", icon: "documents", section: "brain", cap: "documents.view" },
  { href: "/executive", label: "Executive", icon: "executive", section: "workspace", cap: "executive.view" },
  { href: "/approvals", label: "Approvals", icon: "approvals", section: "workspace", cap: "approvals.view" },
  { href: "/settings", label: "Settings", icon: "settings", section: "workspace", cap: "settings.view" },
];

export function navFor(role: Role): NavItem[] {
  return NAV.filter((i) => can(role, i.cap));
}

export function titleFor(pathname: string): string {
  if (pathname.startsWith("/design")) return "Design system";
  return NAV.find((i) => pathname === i.href || pathname.startsWith(i.href + "/"))?.label ?? "K!larity";
}
