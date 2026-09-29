// Owner task: EB-101 Command palette and global search — permission-filtered search over the caller's tenant.
import { NextResponse, type NextRequest } from "next/server";

import type { SearchHit } from "@/components/shell/CommandPalette";
import { activeMembership, getSession } from "@/lib/auth/session";
import { tenantView } from "@/lib/data/store";
import { can } from "@/lib/permissions";

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
  return NextResponse.json({ hits }, { headers: { "cache-control": "no-store" } });
}
