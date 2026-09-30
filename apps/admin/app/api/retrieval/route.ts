// Owner task: EB-88 Tenant admin console — retrieval console API (screen 51). Only during an impersonation of the tenant;
// every query is audited with the operator's reason. The permission filter runs before any scoring (lib/retrieval.ts).
import { NextResponse } from "next/server";

import { audit, corpusFor, getTenant, SEARCH_AS } from "@/lib/data";
import { runRetrieval } from "@/lib/retrieval";
import { getOperator } from "@/lib/session";

export async function POST(req: Request) {
  const s = await getOperator();
  if (!s) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!s.impersonating) return NextResponse.json({ error: "start an audited view of a tenant first" }, { status: 403 });
  const t = getTenant(s.impersonating.tenantId);
  if (!t || t.status !== "active") return NextResponse.json({ error: "tenant not available" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { q?: unknown; as?: unknown };
  const q = typeof body.q === "string" ? body.q.trim().slice(0, 200) : "";
  const who = SEARCH_AS.find((x) => x.id === body.as) ?? SEARCH_AS[0]!;
  if (!q) return NextResponse.json({ error: "enter a query" }, { status: 400 });

  audit(s.operator.name, "retrieval.query", t.slug, s.impersonating.reason, `“${q}” as ${who.label}`);
  return NextResponse.json(runRetrieval(corpusFor(t), q, who.tokens), { headers: { "cache-control": "no-store" } });
}
