// Owner task: EB-23 Web UI shell — navigation model. Items are filtered by role, never just hidden by CSS.
import type { Role } from "./session";

export type IconName =
  | "ask"
  | "projects"
  | "finance"
  | "decisions"
  | "documents"
  | "approvals"
  | "executive"
  | "settings";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  section: "brain" | "workspace";
  roles?: Role[]; // omitted = everyone
}

export const NAV: NavItem[] = [
  { href: "/ask", label: "Ask Brain", icon: "ask", section: "brain" },
  { href: "/projects", label: "Projects", icon: "projects", section: "brain" },
  { href: "/finance", label: "Finance", icon: "finance", section: "brain", roles: ["owner", "partner"] },
  { href: "/decisions", label: "Decisions", icon: "decisions", section: "brain" },
  { href: "/documents", label: "Documents", icon: "documents", section: "brain" },
  { href: "/executive", label: "Executive", icon: "executive", section: "workspace", roles: ["owner", "partner"] },
  { href: "/approvals", label: "Approvals", icon: "approvals", section: "workspace" },
  { href: "/settings", label: "Settings", icon: "settings", section: "workspace", roles: ["owner"] },
];

export function navFor(role: Role): NavItem[] {
  return NAV.filter((i) => !i.roles || i.roles.includes(role));
}

export function titleFor(pathname: string): string {
  return NAV.find((i) => pathname === i.href || pathname.startsWith(i.href + "/"))?.label ?? "K!larity";
}
