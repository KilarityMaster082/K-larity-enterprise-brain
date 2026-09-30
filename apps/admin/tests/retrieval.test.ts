// Owner task: EB-88 Tenant admin console — BM25, fusion, permission filter and the query plan of the retrieval console.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { corpusFor, getTenant, listTenants, SEARCH_AS } from "@/lib/data";
import { aclAllows, bm25, rrf, runRetrieval, tokenize } from "@/lib/retrieval";

const studio = () => corpusFor(listTenants().find((t) => t.slug === "studio8")!);
const tokensOf = (id: string) => SEARCH_AS.find((s) => s.id === id)!.tokens;

describe("bm25", () => {
  const docs = [
    { id: "a", text: "steel beam steel column" },
    { id: "b", text: "concrete slab with steel" },
    { id: "c", text: "paint and plaster" },
  ];
  it("ranks the document that uses the term more, and skips documents without it", () => {
    const s = bm25(docs, "steel");
    assert.ok(s.get("a")! > s.get("b")!);
    assert.equal(s.has("c"), false);
  });
  it("gives a rarer term more weight", () => {
    const s = bm25(docs, "steel paint");
    assert.ok(s.get("c")! > s.get("b")!, "paint appears once in 3 docs, steel in 2");
  });
  it("an empty or stop-word query scores nothing", () => {
    assert.equal(bm25(docs, "the of").size, 0);
    assert.equal(bm25([], "steel").size, 0);
  });
  it("tokenises rupee amounts and drops stop words", () => assert.deepEqual(tokenize("What is the cost ₹9,20,000"), ["cost", "₹9", "20", "000"]));
});

describe("rrf", () => {
  it("rewards ids that rank high, weights channels, and sums across lists", () => {
    const f = rrf([{ weight: 1, ids: ["x", "y"] }, { weight: 0.5, ids: ["y"] }], 60);
    assert.ok(Math.abs(f.get("x")! - 1 / 61) < 1e-12);
    assert.ok(Math.abs(f.get("y")! - (1 / 62 + 0.5 / 61)) < 1e-12);
  });
});

describe("retrieval console", () => {
  it("applies the permission filter before scoring and reports only a count of what it hid", () => {
    const res = runRetrieval(studio(), "facade HPL cost", tokensOf("consultant"));
    assert.equal(res.hiddenByAcl > 0, true);
    const visible = new Set(studio().filter((c) => aclAllows(c.acl, tokensOf("consultant"))).map((c) => c.chunkId));
    for (const h of res.hits) assert.ok(visible.has(h.chunkId), `${h.chunkId} must be visible to the consultant`);
    assert.doesNotMatch(JSON.stringify(res), /9,20,000|14,80,000/, "hidden chunk text never leaves the server");
    assert.equal(res.plan[1]!.name, "Permission filter");
  });
  it("the same query as the index view finds the chunks the consultant cannot", () => {
    const all = runRetrieval(studio(), "facade HPL cost", "all");
    const cons = runRetrieval(studio(), "facade HPL cost", tokensOf("consultant"));
    assert.ok(all.hits.length > cons.hits.length);
    assert.equal(all.hiddenByAcl, 0);
  });
  it("hidden documents do not change a visible document's score", () => {
    const visibleOnly = studio().filter((c) => aclAllows(c.acl, tokensOf("consultant")));
    const a = runRetrieval(studio(), "transfer beam", tokensOf("consultant"));
    const b = runRetrieval(visibleOnly, "transfer beam", tokensOf("consultant"));
    assert.deepEqual(a.hits.map((h) => [h.chunkId, h.bm25]), b.hits.map((h) => [h.chunkId, h.bm25]));
  });
  it("records a timed plan, with the dense channel honestly skipped, and checks the rerank SLA", () => {
    let t = 0;
    const res = runRetrieval(studio(), "transfer beam ISMB 600", "all", () => (t += 10));
    assert.deepEqual(res.plan.map((s) => s.name), ["Understand query", "Permission filter", "BM25 (keyword)", "Dense (vector)", "Reciprocal-rank fusion", "Rerank"]);
    assert.equal(res.plan.find((s) => s.name === "Dense (vector)")!.status, "skipped");
    assert.equal(res.rerank.durationMs, 10);
    assert.equal(res.rerank.slaMet, true);
    const slow = runRetrieval(studio(), "transfer beam", "all", (() => { let n = 0; return () => (n += 250); })());
    assert.equal(slow.rerank.slaMet, true);
    const slower = runRetrieval(studio(), "transfer beam", "all", (() => { let n = 0; return () => (n += 450); })());
    assert.equal(slower.rerank.slaMet, false);
  });
  it("phrase proximity lifts the chunk that has the terms together", () => {
    const res = runRetrieval(studio(), "transfer beam", "all");
    assert.equal(res.hits[0]!.chunkId, "c3");
    assert.ok(res.hits[0]!.rerank > res.hits[0]!.bm25);
  });
  it("another tenant's corpus is its own", () => {
    const canary = listTenants().find((t) => t.isSynthetic)!;
    assert.equal(runRetrieval(corpusFor(canary), "facade HPL", "all").hits.length, 0);
    assert.ok(getTenant(canary.tenantId));
  });
});
