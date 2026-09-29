// Owner task: EB-88 Tenant admin console — retrieval console API. Only during an impersonation of the tenant;
// every query is audited. Development scoring is term overlap; production calls the context engine's retrieval
// debug endpoint with the same ACL filter it applies for real users.
import { NextResponse } from "next/server";

import { audit, corpusFor, getTenant, SEARCH_AS } from "@/lib/data";
import { getOperator } from "@/lib/session";

const STOP = new Set(["the", "and", "for", "with", "what", "why", "was", "are", "is", "of", "to", "a", "in", "on"]);

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

  const terms = [...new Set(q.toLowerCase().split(/[^a-z0-9₹,]+/).filter((w) => w.length > 2 && !STOP.has(w)))];
  const scored = corpusFor(t)
    .map((c) => {
      const text = `${c.title} ${c.text}`.toLowerCase();
      const score = terms.reduce((acc, term) => acc + (text.includes(term) ? 1 + (c.title.toLowerCase().includes(term) ? 0.5 : 0) : 0), 0) / Math.max(1, terms.length);
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const allowed = (acl: string[]) => who.tokens === "all" || acl.some((a) => (who.tokens as string[]).includes(a));
  const visible = scored.filter((x) => allowed(x.c.acl));
  return NextResponse.json({
    terms,
    filteredOut: scored.length - visible.length,
    hits: visible.slice(0, 10).map((x, i) => ({ rank: i + 1, score: x.score, chunkId: x.c.chunkId, title: x.c.title, sourceType: x.c.sourceType, text: x.c.text, acl: x.c.acl })),
  });
}
