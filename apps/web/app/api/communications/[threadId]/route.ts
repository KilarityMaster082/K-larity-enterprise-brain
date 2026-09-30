// Owner task: EB-103 Communications hub — GET /api/communications/[threadId]: what the composer needs to open a reply.
// Same visibility rules as the page: another tenant's thread, or one this role may not see, is "not found".
import { NextResponse } from "next/server";

import { activeMembership, getSession } from "@/lib/auth/session";
import { suggestDraft, suggestionSentence } from "@/lib/compose";
import { tenantView } from "@/lib/data/store";
import { can } from "@/lib/permissions";
import { visibleMail } from "@/lib/workspace";

export async function GET(_req: Request, ctx: { params: Promise<{ threadId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const m = activeMembership(session);
  if (!can(m.role, "comms.view")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { threadId } = await ctx.params;
  const view = tenantView(m.tenantId, m.slug);
  const t = visibleMail(view, (c) => can(m.role, c)).find((x) => x.threadId === threadId.slice(0, 100));
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });
  const project = view.data.projects.find((p) => p.projectId === t.projectId);
  const lead = project ? view.data.people.find((p) => p.personId === project.leadId)?.name : undefined;
  return NextResponse.json(
    {
      threadId: t.threadId,
      subject: t.subject,
      to: t.fromOrg === "Studio 8 Hats" ? t.fromName : t.fromOrg,
      cc: lead ? `${lead}${project ? ` (${project.name.replace(/^Project /, "")})` : ""}` : "",
      suggestion: suggestDraft(t),
      suggestionText: suggestionSentence(t),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
