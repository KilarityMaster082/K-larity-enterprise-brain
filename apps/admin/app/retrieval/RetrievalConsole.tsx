"use client";
// Owner task: EB-88 Tenant admin console — query box, the query plan with per-stage timings, ranked results with BM25 / fused /
// rerank scores and ACL tokens, and the count (never the content) of chunks the permission filter removed.
import { Bento, BentoHead, EmptyState, Pill } from "@klarity/ui";
import { useState, useTransition, type ReactNode } from "react";

import type { RetrievalResult } from "@/lib/retrieval";

function highlight(text: string, terms: string[]): ReactNode {
  if (!terms.length) return text;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i} className="eb-hl">{part}</mark> : part));
}

export function RetrievalConsole({ tenantName, searchAs }: { tenantName: string; searchAs: { id: string; label: string }[] }) {
  const [q, setQ] = useState("");
  const [as, setAs] = useState(searchAs[0]!.id);
  const [res, setRes] = useState<RetrievalResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function run() {
    if (!q.trim()) return;
    start(async () => {
      setErr(null);
      const r = await fetch("/api/retrieval", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q, as }) });
      if (!r.ok) {
        setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`);
        setRes(null);
      } else setRes((await r.json()) as RetrievalResult);
    });
  }

  return (
    <div className="eb-stack">
      <Bento tone="strong" aria-label="Query">
        <form
          className="eb-stack"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <p className="eb-note">Searching <b>{tenantName}</b>. This query is recorded in the audit log.</p>
          <div className="eb-row" style={{ gap: 10, alignItems: "flex-end" }}>
            <label className="field eb-grow">
              Query
              <input className="eb-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. facade HPL cost" maxLength={200} />
            </label>
            <label className="field">
              Search as
              <select className="eb-input" value={as} onChange={(e) => setAs(e.target.value)}>
                {searchAs.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </label>
            <button type="submit" className="eb-pill" data-tone="black" data-size="lg" disabled={busy || !q.trim()}>Run retrieval</button>
          </div>
        </form>
      </Bento>
      {err ? <p className="eb-note" role="alert">{err}</p> : null}
      {res ? (
        <>
          <Bento tone="lavender" aria-label="Query plan">
            <BentoHead
              title="Query plan"
              aside={
                <Pill size="sm" tone={res.rerank.slaMet ? "green" : "pink"} title={res.rerank.model}>
                  rerank {res.rerank.durationMs.toFixed(1)} ms · SLA {res.rerank.slaMs} ms {res.rerank.slaMet ? "met" : "missed"}
                </Pill>
              }
            />
            <ol className="eb-plan">
              {res.plan.map((s) => (
                <li key={s.name} data-skipped={s.status === "skipped" || undefined}>
                  <span className="nm">{s.name}</span>
                  <span className="eb-grow">{s.detail}</span>
                  <span className="ms">{s.status === "skipped" ? "skipped" : `${s.ms.toFixed(1)} ms`}</span>
                </li>
              ))}
            </ol>
            <p className="eb-note">Reranker: {res.rerank.model}, {res.rerank.candidates} candidates.</p>
          </Bento>
          <Bento tone="strong" aria-label="Results">
            <BentoHead title={`${res.hits.length} result${res.hits.length === 1 ? "" : "s"}`} aside={res.hiddenByAcl ? <Pill size="sm" tone="cream">{res.hiddenByAcl} hidden by the permission filter</Pill> : null} />
            {res.hits.length ? (
              <ol className="eb-list" aria-label="Ranked results">
                {res.hits.map((h) => (
                  <li key={h.chunkId} className="eb-li" style={{ display: "block" }}>
                    <div className="eb-row" style={{ justifyContent: "space-between", gap: 8 }}>
                      <b>#{h.rank} · {h.title}</b>
                      <span className="eb-row" style={{ gap: 6 }}>
                        <Pill size="sm" tone="outline">{h.sourceType}</Pill>
                        <Pill size="sm" tone="sky" title="BM25">bm25 {h.bm25.toFixed(2)}</Pill>
                        <Pill size="sm" tone="lavender" title="Reciprocal-rank fusion">rrf {h.fused.toFixed(4)}</Pill>
                        <Pill size="sm" tone="lime" title="After rerank">rerank {h.rerank.toFixed(2)}</Pill>
                      </span>
                    </div>
                    <p className="eb-body" style={{ margin: "4px 0" }}>{highlight(h.text, res.terms)}</p>
                    <span className="eb-row" style={{ gap: 6 }}>{h.acl.map((a) => <code key={a} className="eb-mono">{a}</code>)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState icon="search" title="No results" compact>
                <p>{res.hiddenByAcl ? "Matching chunks exist but this user may not see them." : "Nothing in the index matches."}</p>
              </EmptyState>
            )}
          </Bento>
        </>
      ) : null}
    </div>
  );
}
