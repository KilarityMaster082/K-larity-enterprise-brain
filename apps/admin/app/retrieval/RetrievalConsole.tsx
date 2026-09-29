"use client";
// Owner task: EB-88 Tenant admin console — query box and ranked results with scores, ACL tokens and filtering.
import { Badge, Card, EmptyState } from "@klarity/ui";
import { useState, useTransition, type ReactNode } from "react";

interface Hit {
  rank: number;
  score: number;
  chunkId: string;
  title: string;
  sourceType: string;
  text: string;
  acl: string[];
}
interface Result {
  hits: Hit[];
  filteredOut: number;
  terms: string[];
}

function highlight(text: string, terms: string[]): ReactNode {
  if (!terms.length) return text;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

export function RetrievalConsole({ tenantName, searchAs }: { tenantName: string; searchAs: { id: string; label: string }[] }) {
  const [q, setQ] = useState("");
  const [as, setAs] = useState(searchAs[0]!.id);
  const [res, setRes] = useState<Result | null>(null);
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
      } else setRes((await r.json()) as Result);
    });
  }

  return (
    <div className="stack">
      <form
        className="card card-pad stack"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>
          Searching <strong>{tenantName}</strong>. This query is recorded in the audit log.
        </p>
        <div className="grid-main-side">
          <label className="field">
            Query
            <input className="input input-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. facade HPL cost" maxLength={200} />
          </label>
          <label className="field">
            Search as
            <select className="select" value={as} onChange={(e) => setAs(e.target.value)}>
              {searchAs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={busy || !q.trim()}>
            Run retrieval
          </button>
        </div>
      </form>
      {err ? (
        <p className="note" role="alert">
          {err}
        </p>
      ) : null}
      {res ? (
        <Card title={`${res.hits.length} result${res.hits.length === 1 ? "" : "s"}`} actions={res.filteredOut ? <Badge tone="warn">{res.filteredOut} hidden by ACL for this user</Badge> : null} pad={false}>
          {res.hits.length ? (
            <ol className="list-plain" aria-label="Ranked results">
              {res.hits.map((h) => (
                <li key={h.chunkId} className="hit">
                  <div className="row-between">
                    <strong>
                      #{h.rank} · {h.title}
                    </strong>
                    <span className="row">
                      <Badge>{h.sourceType}</Badge>
                      <Badge tone="brand">score {h.score.toFixed(2)}</Badge>
                    </span>
                  </div>
                  <p>{highlight(h.text, res.terms)}</p>
                  <span className="row">
                    {h.acl.map((a) => (
                      <code key={a} style={{ fontSize: "var(--fs-xs)" }}>
                        {a}
                      </code>
                    ))}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <div style={{ padding: "var(--s-5)" }}>
              <EmptyState icon="search" title="No results" compact>
                <p>{res.filteredOut ? "Matching chunks exist but this user may not see them." : "Nothing in the index matches."}</p>
              </EmptyState>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}
