// Owner task: EB-101 Command palette and global search — permission-filtered search over the caller's tenant.
import { NextResponse, type NextRequest } from "next/server";

import type { SearchHit } from "@/components/shell/CommandPalette";
import { activeMembership, getSession } from "@/lib/auth/session";
import { tenantView } from "@/lib/data/store";
import { can } from "@/lib/permissions";
import { visibleMail } from "@/lib/workspace";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const m = activeMembership(session);
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 100);
  if (q.length < 2) return NextResponse.json({ hits: [] });
  const { data } = tenantView(m.tenantId, m.slug);
  const has = (...xs: (string | undefined)[]) => xs.some((x) => x?.toLowerCase().includes(q));
  const projectName = (id: string) => data.projects.find((p) => p.projectId === id)?.name;
  const hits: SearchHit[] = [];
  if (can(m.role, "projects.view")) {
    for (const p of data.projects.filter((p) => has(p.name, p.code, p.client, p.location)).slice(0, 5))
      hits.push({ group: "Projects", label: p.name, sub: p.location, href: `/projects/${p.projectId}`, icon: "projects" });
  }
  if (can(m.role, "documents.view")) {
    for (const d of data.documents.filter((d) => d.isLatest && has(d.title, d.series, d.summary)).slice(0, 6))
      hits.push({
        group: "Documents",
        label: d.series ? `${d.series} Rev ${d.revision} — ${d.title}` : d.title,
        sub: projectName(d.projectId),
        href: `/documents?doc=${d.documentId}`,
        icon: "documents",
      });
  }
  if (can(m.role, "decisions.view")) {
    for (const d of data.decisions.filter((d) => d.status !== "revoked" && has(d.title, d.description)).slice(0, 5))
      hits.push({ group: "Decisions", label: d.title, sub: projectName(d.projectId), href: `/decisions?focus=${d.decisionId}`, icon: "decisions" });
  }
  const view = tenantView(m.tenantId, m.slug);
  const canDo = (c: Parameters<typeof can>[1]) => can(m.role, c);
  if (canDo("comms.view")) {
    for (const t of visibleMail(view, canDo).filter((t) => has(t.subject, t.fromName, t.fromOrg)).slice(0, 5))
      hits.push({ group: "Email threads", label: t.subject, sub: t.fromOrg, href: `/communications/${t.threadId}`, icon: "mail" });
  }
  if (canDo("meetings.view")) {
    for (const mt of data.workspace.meetings.filter((x) => has(x.title, ...x.agenda)).slice(0, 4))
      hits.push({ group: "Meetings", label: mt.title, sub: projectName(mt.projectId ?? ""), href: `/meetings/${mt.meetingId}/prep`, icon: "meetings" });
  }
  if (canDo("todos.view")) {
    for (const td of data.workspace.todos.filter((x) => has(x.text, x.assignee)).slice(0, 4))
      hits.push({ group: "Todos", label: td.text, sub: td.assignee, href: `/todos?focus=${td.todoId}`, icon: "todo" });
  }
  if (canDo("spaces.view")) {
    for (const sp of data.workspace.spaces.filter((x) => has(x.name, x.topic)).slice(0, 3))
      hits.push({ group: "Spaces", label: `#${sp.name}`, sub: sp.topic, href: `/spaces/${sp.spaceId}`, icon: "spaces" });
  }
  if (canDo("apps.manage")) {
    for (const a of data.workspace.apps.filter((x) => has(x.name, x.vendor)).slice(0, 3)) hits.push({ group: "Apps", label: a.name, sub: a.vendor, href: `/apps/${a.appId}`, icon: "apps" });
  }
  return NextResponse.json({ hits }, { headers: { "cache-control": "no-store" } });
}
