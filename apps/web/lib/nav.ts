// Owner task: EB-23 Web UI shell — navigation. The icon rail carries the eight primary screens of the handoff; every
// other screen is reachable from the launcher, ⌘K and in-screen links. Items are filtered by capability on the
// server; pages check again, so hiding an item is a convenience, never the protection.
import type { IconName, RailItem } from "@klarity/ui";

import type { Role } from "./data/types";
import { can, type Capability } from "./permissions";
import { SCREENS } from "./screens";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  cap: Capability;
  /** Other path prefixes that keep this item highlighted. */
  match?: string[];
}

export const NAV: NavItem[] = [
  { href: "/ask", label: "Ask Brain", icon: "ask", cap: "ask", match: ["/history", "/explore"] },
  { href: "/projects", label: "Projects", icon: "projects", cap: "projects.view" },
  { href: "/finance", label: "Finance", icon: "finance", cap: "finance.view" },
  { href: "/decisions", label: "Decisions", icon: "decisions", cap: "decisions.view" },
  { href: "/documents", label: "Documents", icon: "documents", cap: "documents.view", match: ["/knowledge"] },
  { href: "/executive", label: "Executive", icon: "executive", cap: "executive.view" },
  { href: "/approvals", label: "Approvals", icon: "approvals", cap: "approvals.view" },
  { href: "/settings/sources", label: "Settings", icon: "settings", cap: "settings.view", match: ["/settings", "/apps"] },
];

export function navFor(role: Role): NavItem[] {
  return NAV.filter((i) => can(role, i.cap));
}

export function railFor(role: Role, counts: Partial<Record<string, number>>): RailItem[] {
  return navFor(role).map((i) => ({ href: i.href, label: i.label, icon: i.icon, match: i.match, badge: counts[i.href] }));
}

/** The mono route pill in the top bar: the concrete path, without query. */
export function routeLabel(pathname: string): string {
  return pathname || "/";
}

/** Catalog number for a concrete pathname (used for the crumb line). */
export function screenNumberFor(pathname: string): number | undefined {
  const p = pathname.replace(/\/+$/, "") || "/";
  const exact = SCREENS.find((s) => !s.overlay && s.route === p);
  if (exact) return exact.n;
  const patterns: [RegExp, number][] = [
    [/^\/communications\/[^/]+$/, 6],
    [/^\/projects\/[^/]+$/, 13],
    [/^\/meetings\/[^/]+\/prep$/, 20],
    [/^\/spaces\/[^/]+\/files$/, 28],
    [/^\/spaces\/[^/]+$/, 27],
    [/^\/apps\/[^/]+$/, 39],
    [/^\/settings$/, 43],
  ];
  return patterns.find(([re]) => re.test(p))?.[1];
}

export function titleFor(pathname: string): string {
  if (pathname.startsWith("/design")) return "Design system";
  const n = screenNumberFor(pathname);
  return (n ? SCREENS.find((s) => s.n === n)?.title : undefined) ?? "K!larity";
}
