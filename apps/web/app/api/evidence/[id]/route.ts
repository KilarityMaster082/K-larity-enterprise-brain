// Owner task: EB-42 Permission filter — GET /api/evidence/[id]: one piece of evidence for the Evidence Side-Sheet,
// after re-checking the caller's tenant and role. Another tenant's evidence is indistinguishable from "not found".
import { NextResponse } from "next/server";

import { activeMembership, getSession } from "@/lib/auth/session";
import { tenantView } from "@/lib/data/store";
import { readEvidence } from "@/lib/evidence-access";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const m = activeMembership(session);
  const { id } = await ctx.params;
  const res = readEvidence(tenantView(m.tenantId, m.slug), m.role, id.slice(0, 200));
  if (!res.ok) return NextResponse.json({ error: res.status === 403 ? "forbidden" : "not found" }, { status: res.status });
  return NextResponse.json({ evidence: res.evidence }, { headers: { "cache-control": "no-store" } });
}
