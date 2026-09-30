// Owner task: EB-102 File viewers — GET /api/files/[id]: one document's parsed content for the viewer overlay. Tenant-scoped
// and role-checked by readFile; another tenant's document is "not found", never "forbidden".
import { NextResponse } from "next/server";

import { activeMembership, getSession } from "@/lib/auth/session";
import { tenantView } from "@/lib/data/store";
import { readFile } from "@/lib/viewers/read";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const m = activeMembership(session);
  const { id } = await ctx.params;
  const r = readFile(tenantView(m.tenantId, m.slug), m.role, id.slice(0, 100));
  if (!r.ok) return NextResponse.json({ error: r.status === 404 ? "not found" : "forbidden", reason: r.reason }, { status: r.status });
  return NextResponse.json(r.file, { headers: { "cache-control": "private, no-store" } });
}
