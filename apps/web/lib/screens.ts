// Owner task: EB-23 Web UI shell — the 45 tenant screens of docs/architecture/SCREENS_CATALOG.md (numbers 1–45;
// 46–54 are the operator console in apps/admin/lib/screens.ts). One registry drives the screen launcher, the
// command palette, the crumb line above each screen and the role gate; tests/screens.test.ts checks it against the
// catalog table and against the route files on disk, so a screen cannot be dropped or renamed unnoticed.
import type { Capability } from "./permissions";

export type GroupKey = "core" | "comms" | "work" | "meet" | "agents" | "viewers" | "apps";

export interface ScreenDef {
  n: number;
  title: string;
  /** Route as printed in the catalog (may carry [params] or a query). */
  route: string;
  /** Where the launcher sends people (a concrete, openable URL). */
  href: string;
  /** Role column of the catalog. */
  role: string;
  /** Status column of the handoff README. */
  status: string;
  group: GroupKey;
  /** Capability required to open it; undefined = public. */
  cap?: Capability;
  /** Screens that open over a parent instead of being a page of their own. */
  overlay?: "sheet" | "drawer" | "modal" | "palette";
}

export const GROUPS: { key: GroupKey; label: string }[] = [
  { key: "core", label: "Core Brain" },
  { key: "comms", label: "Communications & Knowledge" },
  { key: "work", label: "Projects, Finance & Decisions" },
  { key: "meet", label: "Meetings & Todos" },
  { key: "agents", label: "Agents, Spaces & Activity" },
  { key: "viewers", label: "File Viewers" },
  { key: "apps", label: "Apps & Settings" },
];

const S = (n: number, title: string, route: string, href: string, role: string, status: string, group: GroupKey, cap?: Capability, overlay?: ScreenDef["overlay"]): ScreenDef => ({
  n,
  title,
  route,
  href,
  role,
  status,
  group,
  cap,
  overlay,
});

export const SCREENS: ScreenDef[] = [
  S(1, "Ask Brain Home & Thread", "/ask", "/ask", "Everyone", "Built & Live", "core", "ask"),
  S(2, "Evidence & Source Side-Sheet", "/ask?source=", "/ask", "Everyone", "Built & Live", "core", "ask", "sheet"),
  S(3, "SSO Sign-In & Tenant Switcher", "/login", "/login", "Public", "Built & Live", "core"),
  S(4, "Onboarding Wizard", "/onboarding", "/onboarding", "Admin / Owner", "Next to Build", "core", "onboarding.run"),
  S(5, "Communications & Email Feed", "/communications", "/communications", "Everyone", "Adapted", "comms", "comms.view"),
  S(6, "Email Thread & AI Extraction", "/communications/[threadId]", "/communications", "Everyone", "Adapted", "comms", "comms.view"),
  S(7, "Email Composer & Reply", "Drawer", "/communications", "Everyone", "Adapted", "comms", "comms.view", "drawer"),
  S(8, "Knowledge Hub", "/knowledge", "/knowledge", "Everyone", "Adapted", "comms", "knowledge.view"),
  S(9, "Knowledge File Vault", "/knowledge/files", "/knowledge/files", "Everyone", "Adapted", "comms", "knowledge.view"),
  S(10, "Structured Bases", "/knowledge/bases", "/knowledge/bases", "Everyone", "Adapted", "comms", "knowledge.view"),
  S(11, "Visual Knowledge Graph", "/knowledge/graph", "/knowledge/graph", "Everyone", "Adapted", "comms", "knowledge.view"),
  S(12, "Projects Fleet Overview", "/projects", "/projects", "Everyone", "Design Active", "work", "projects.view"),
  S(13, "Project Detail Hub", "/projects/[id]", "/projects", "Everyone", "Design Active", "work", "projects.view"),
  S(14, "Decisions Queue & Log", "/decisions", "/decisions", "Everyone", "Built & Live", "work", "decisions.view"),
  S(15, "Document & Drawing Vault", "/documents", "/documents", "Everyone", "Built & Live", "work", "documents.view"),
  S(16, "Finance & Cash Control", "/finance", "/finance", "Owner / Partner", "Built & Live", "work", "finance.view"),
  S(17, "Executive Briefing Cockpit", "/executive", "/executive", "Owner / Partner", "Built & Live", "work", "executive.view"),
  S(18, "Action Approvals Queue", "/approvals", "/approvals", "Role gated", "Built & Live", "work", "approvals.view"),
  S(19, "Meetings & Calendar Hub", "/meetings", "/meetings", "Everyone", "Adapted", "meet", "meetings.view"),
  S(20, "Meeting Dossier & Prep Brief", "/meetings/[id]/prep", "/meetings", "Everyone", "Adapted", "meet", "meetings.view"),
  S(21, "Live Notes & Transcription", "/meetings/live", "/meetings/live", "Everyone", "Adapted", "meet", "meetings.view"),
  S(22, "Video / Audio Call View", "/meetings/call", "/meetings/call", "Everyone", "Adapted", "meet", "meetings.view"),
  S(23, "Action Todos & Commitments", "/todos", "/todos", "Everyone", "Adapted", "meet", "todos.view"),
  S(24, "Background Agents Monitor", "/tasks", "/tasks", "Owner / Partner", "Adapted", "agents", "agents.view"),
  S(25, "Agent Run Inspector", "Drawer", "/tasks", "Owner / Partner", "Adapted", "agents", "agents.view", "drawer"),
  S(26, "Spaces & Channels Hub", "/spaces", "/spaces", "Everyone", "Adapted", "agents", "spaces.view"),
  S(27, "Space Discussion Feed", "/spaces/[id]", "/spaces", "Everyone", "Adapted", "agents", "spaces.view"),
  S(28, "Space Pinned Files", "/spaces/[id]/files", "/spaces", "Everyone", "Adapted", "agents", "spaces.view"),
  S(29, "Team Activity Stream", "/activity", "/activity", "Everyone", "Adapted", "agents", "activity.view"),
  S(30, "Spreadsheet & BOQ Viewer", "Modal", "/documents", "Everyone", "Adapted", "viewers", "documents.view", "modal"),
  S(31, "PDF Document Viewer", "Modal", "/documents", "Everyone", "Adapted", "viewers", "documents.view", "modal"),
  S(32, "Word Document Viewer", "Modal", "/documents", "Everyone", "Adapted", "viewers", "documents.view", "modal"),
  S(33, "Slide Deck Viewer", "Modal", "/documents", "Everyone", "Adapted", "viewers", "documents.view", "modal"),
  S(34, "Site Photo Viewer", "Modal", "/documents", "Everyone", "Adapted", "viewers", "documents.view", "modal"),
  S(35, "Video Inspection Player", "Modal", "/documents", "Everyone", "Adapted", "viewers", "documents.view", "modal"),
  S(36, "Voice Note Player", "Modal", "/documents", "Everyone", "Adapted", "viewers", "documents.view", "modal"),
  S(37, "Code & Diff Inspector", "Modal", "/documents", "Technical / Admin", "Adapted", "viewers", "code.view", "modal"),
  S(38, "App Store & Tool Catalog", "/apps", "/apps", "Owner / Partner", "Adapted", "apps", "apps.manage"),
  S(39, "App Detail & Connection", "/apps/[id]", "/apps", "Owner / Partner", "Adapted", "apps", "apps.manage"),
  S(40, "Session History & Chat Archive", "/history", "/history", "Everyone", "Adapted", "core", "history.view"),
  S(41, "Suggested Topics & Trends", "/explore", "/explore", "Everyone", "Adapted", "core", "explore.view"),
  S(42, "Global Command Palette", "⌘K", "/ask", "Everyone", "Adapted", "core", "ask", "palette"),
  S(43, "Settings · Connected Sources", "/settings/sources", "/settings/sources", "Owner / Partner", "Design Active", "apps", "sources.manage"),
  S(44, "Settings · Members & Roles", "/settings/members", "/settings/members", "Owner", "Design Active", "apps", "members.manage"),
  S(45, "Settings · Retention & Security", "/settings/security", "/settings/security", "Owner", "Design Active", "apps", "security.manage"),
];

export function screenByN(n: number): ScreenDef {
  const s = SCREENS.find((x) => x.n === n);
  if (!s) throw new Error(`unknown screen ${n}`);
  return s;
}

/** The crumb line above a screen ("12 / 54 · Projects Fleet Overview · Everyone · Design Active"). */
export function crumb(n: number): { n: number; title: string; role: string; status: string } {
  const s = screenByN(n);
  return { n: s.n, title: s.title, role: s.role, status: s.status };
}

/** Screens a role may open; overlays and the public login page are not navigation targets. */
export function launcherFor(can: (c: Capability) => boolean): { label: string; items: { n: number; title: string; href: string }[] }[] {
  return GROUPS.map((g) => ({
    label: g.label,
    items: SCREENS.filter((s) => s.group === g.key && !s.overlay && s.cap && can(s.cap) && !/\[/.test(s.route)).map((s) => ({ n: s.n, title: s.title, href: s.href })),
  })).filter((g) => g.items.length);
}
