// Owner task: EB-88 Tenant admin console — the retrieval console's pipeline (screen 51): permission filter FIRST, then BM25,
// reciprocal-rank fusion and a rerank step, each timed, so an operator can see the query plan. Development scorer: real BM25
// (k1 1.5, b 0.75) over the tenant's own chunks and a lexical-proximity reranker. The dense (vector) channel is reported as
// unavailable rather than invented. Production calls the context engine's retrieval debug endpoint with the same ACL filter.
import type { Chunk } from "./data";

export const RERANK_SLA_MS = 400; // services/context-engine/rerank.py DEFAULT_P95_SLA_MS
export const RRF_K = 60; // services/context-engine/retrieve.py DEFAULT_RRF_K
export const CHANNEL_WEIGHTS = { dense: 1.0, bm25: 0.8, sparse: 0.5 } as const;

const STOP = new Set(["the", "and", "for", "with", "what", "why", "was", "are", "is", "of", "to", "a", "in", "on", "we", "our"]);

export function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9₹]+/).filter((w) => w.length > 1 && !STOP.has(w));
}

/** BM25 over `docs`; document frequencies come from `docs` only, so hidden chunks cannot influence a visible score. */
export function bm25(docs: { id: string; text: string }[], query: string, k1 = 1.5, b = 0.75): Map<string, number> {
  const terms = [...new Set(tokenize(query))];
  const tokens = docs.map((d) => tokenize(d.text));
  const N = docs.length;
  const avg = N ? tokens.reduce((a, t) => a + t.length, 0) / N : 0;
  const scores = new Map<string, number>();
  for (const term of terms) {
    const df = tokens.filter((t) => t.includes(term)).length;
    if (!df) continue;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    tokens.forEach((t, i) => {
      const tf = t.filter((x) => x === term).length;
      if (!tf) return;
      const s = idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * t.length) / (avg || 1))));
      scores.set(docs[i]!.id, (scores.get(docs[i]!.id) ?? 0) + s);
    });
  }
  return scores;
}

/** Weighted reciprocal-rank fusion of ranked id lists. */
export function rrf(lists: { weight: number; ids: string[] }[], k = RRF_K): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lists) l.ids.forEach((id, rank) => out.set(id, (out.get(id) ?? 0) + l.weight / (k + rank + 1)));
  return out;
}

export type Tokens = string[] | "all";
export function aclAllows(acl: string[], tokens: Tokens): boolean {
  return tokens === "all" || acl.some((a) => tokens.includes(a));
}

export interface Stage {
  name: string;
  status: "ok" | "skipped";
  ms: number;
  detail: string;
}
export interface Hit {
  rank: number;
  chunkId: string;
  title: string;
  sourceType: string;
  text: string;
  acl: string[];
  bm25: number;
  fused: number;
  rerank: number;
}
export interface RetrievalResult {
  terms: string[];
  plan: Stage[];
  hits: Hit[];
  /** How many chunks matched the query but were removed by the permission filter. Count only: never their content. */
  hiddenByAcl: number;
  rerank: { model: string; candidates: number; durationMs: number; slaMs: number; slaMet: boolean };
}

/** Rerank by BM25 plus a bonus for query terms appearing next to each other (a stand-in for a cross-encoder). */
function lexicalRerank(query: string, cands: { id: string; text: string; base: number }[]): Map<string, number> {
  const q = tokenize(query);
  const pairs = q.slice(0, -1).map((t, i) => `${t} ${q[i + 1]}`);
  const out = new Map<string, number>();
  for (const c of cands) {
    const flat = tokenize(c.text).join(" ");
    const bonus = pairs.filter((p) => flat.includes(p)).length;
    out.set(c.id, c.base + 0.5 * bonus);
  }
  return out;
}

export function runRetrieval(chunks: Chunk[], query: string, tokens: Tokens, now: () => number = () => performance.now()): RetrievalResult {
  const terms = [...new Set(tokenize(query))];
  const plan: Stage[] = [];

  let t = now();
  plan.push({ name: "Understand query", status: "ok", ms: now() - t, detail: `${terms.length} term${terms.length === 1 ? "" : "s"}: ${terms.join(", ") || "none"}` });

  t = now();
  const allowed = chunks.filter((c) => aclAllows(c.acl, tokens)); // permissions before retrieval (CLAUDE.md rule 2)
  const hiddenByAcl = chunks.filter((c) => !aclAllows(c.acl, tokens) && terms.some((x) => tokenize(`${c.title} ${c.text}`).includes(x))).length;
  plan.push({ name: "Permission filter", status: "ok", ms: now() - t, detail: tokens === "all" ? "index view: no user filter" : `${allowed.length} of ${chunks.length} chunks visible to this user` });

  t = now();
  const docs = allowed.map((c) => ({ id: c.chunkId, text: `${c.title} ${c.title} ${c.text}` }));
  const scores = bm25(docs, query);
  const bm25Ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  plan.push({ name: "BM25 (keyword)", status: "ok", ms: now() - t, detail: `${bm25Ranked.length} matching chunk${bm25Ranked.length === 1 ? "" : "s"}` });
  plan.push({ name: "Dense (vector)", status: "skipped", ms: 0, detail: "not available in development: no embedding service is connected" });

  t = now();
  const fused = rrf([{ weight: CHANNEL_WEIGHTS.bm25, ids: bm25Ranked }]);
  plan.push({ name: "Reciprocal-rank fusion", status: "ok", ms: now() - t, detail: `k=${RRF_K}, bm25 weight ${CHANNEL_WEIGHTS.bm25}` });

  t = now();
  const cands = bm25Ranked.slice(0, 20).map((id) => ({ id, text: chunks.find((c) => c.chunkId === id)!.text, base: scores.get(id)! }));
  const reranked = lexicalRerank(query, cands);
  const durationMs = now() - t;
  const rerank = { model: "dev-lexical-proximity (stand-in for the cross-encoder)", candidates: cands.length, durationMs, slaMs: RERANK_SLA_MS, slaMet: durationMs <= RERANK_SLA_MS };
  plan.push({ name: "Rerank", status: "ok", ms: durationMs, detail: `${cands.length} candidates, SLA p95 < ${RERANK_SLA_MS} ms` });

  const order = cands.map((c) => c.id).sort((a, b) => reranked.get(b)! - reranked.get(a)! || fused.get(b)! - fused.get(a)!);
  const hits: Hit[] = order.slice(0, 10).map((id, i) => {
    const c = chunks.find((x) => x.chunkId === id)!;
    return { rank: i + 1, chunkId: id, title: c.title, sourceType: c.sourceType, text: c.text, acl: c.acl, bm25: scores.get(id)!, fused: fused.get(id)!, rerank: reranked.get(id)! };
  });
  return { terms, plan, hits, hiddenByAcl, rerank };
}
