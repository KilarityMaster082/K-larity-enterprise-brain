// Owner task: EB-100 Admin console shell — the nine operator screens (46–54) of docs/architecture/SCREENS_CATALOG.md.
// One registry drives the rail, the launcher and the crumb line; tests/screens.test.ts checks it against the catalog and
// against the route files. Every screen is operator-only: the proxy and each page verify the signed operator session.
import type { IconName, LauncherGroup, RailItem } from "@klarity/ui";

export interface OpScreen {
  n: number;
  title: string;
  route: string;
  icon: IconName;
  /** Path prefixes that keep the rail item highlighted. */
  match?: string[];
  /** In the icon rail (the rest are reachable from the launcher and in-screen links). */
  rail?: boolean;
}

export const OP_SCREENS: OpScreen[] = [
  { n: 46, title: "Operator Login & Impersonation Gate", route: "/login", icon: "lock" },
  { n: 47, title: "Tenant Registry Fleet Overview", route: "/tenants", icon: "building", rail: true, match: ["/tenants"] },
  { n: 48, title: "Tenant Detail & Placement Inspector", route: "/tenants/[id]", icon: "building" },
  { n: 49, title: "Ingestion Pipeline & Worker Health", route: "/sources-health", icon: "pulse", rail: true },
  { n: 50, title: "Dead-Letter Queue Inspector", route: "/dead-letter", icon: "alert", rail: true },
  { n: 51, title: "Audited Retrieval Test Console", route: "/retrieval", icon: "search", rail: true },
  { n: 52, title: "LLM Gateway & Budget Metering", route: "/gateway", icon: "gauge", rail: true },
  { n: 53, title: "System Audit Trail Explorer", route: "/audit", icon: "audit", rail: true },
  { n: 54, title: "Cell & Cluster Infrastructure Health", route: "/infrastructure", icon: "server", rail: true },
];

export function opScreen(n: number): OpScreen {
  const s = OP_SCREENS.find((x) => x.n === n);
  if (!s) throw new Error(`unknown operator screen ${n}`);
  return s;
}

export function opCrumb(n: number): { n: number; title: string; role: string; status: string } {
  const s = opScreen(n);
  return { n: s.n, title: s.title, role: "Operator Admin", status: "Built" };
}

export function opRail(badges: Partial<Record<string, number>> = {}): RailItem[] {
  return OP_SCREENS.filter((s) => s.rail).map((s) => ({ href: s.route, label: s.title.replace(/ &.*$| Inspector$| Overview$/, ""), icon: s.icon, match: s.match, badge: badges[s.route] }));
}

export function opLauncher(): LauncherGroup[] {
  return [{ label: "Operator console", items: OP_SCREENS.filter((s) => s.route !== "/login").map((s) => ({ n: s.n, title: s.title, href: s.route.replace("/[id]", ""), route: s.route })) }];
}
