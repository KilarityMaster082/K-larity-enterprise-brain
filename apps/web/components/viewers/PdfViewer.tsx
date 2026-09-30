"use client";
// Owner task: EB-102 File viewers — PDF viewer (screen 31): page thumbnails, in-document search with highlighted matches and
// next/previous, and the evidence overlay — when the file is opened from a citation, the supporting span and the Docling
// bounding box on that page are drawn exactly where the parser found them.
import { PillButton } from "@klarity/ui";
import { useEffect, useMemo, useRef, useState } from "react";

import type { EvidenceLocator } from "@/lib/contracts";
import type { FileContent } from "@/lib/data/types";
import { searchPages, splitRuns } from "@/lib/viewers/search";

type Pdf = Extract<FileContent, { kind: "pdf" }>;

export function PdfViewer({ content, locator }: { content: Pdf; locator?: EvidenceLocator }) {
  const first = locator?.page && content.pages.some((p) => p.n === locator.page) ? locator.page : (content.pages[0]?.n ?? 1);
  const [page, setPage] = useState(first);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const hits = useMemo(() => searchPages(content.pages, query), [content.pages, query]);
  const current = content.pages.find((p) => p.n === page) ?? content.pages[0];
  const pageHits = hits.filter((h) => h.page === page);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector("[data-current]")?.scrollIntoView({ block: "center" });
  }, [cursor, page, query]);

  function step(d: 1 | -1) {
    if (!hits.length) return;
    const next = (cursor + d + hits.length) % hits.length;
    setCursor(next);
    setPage(hits[next]!.page);
  }

  if (!current) return <p className="eb-body">This PDF has no pages.</p>;
  const bbox = locator?.page === current.n ? locator.bbox : undefined;
  return (
    <div className="eb-pdf">
      <nav className="eb-pdf-thumbs" aria-label="Pages">
        {content.pages.map((p) => (
          <button key={p.n} type="button" aria-current={p.n === page ? "page" : undefined} onClick={() => setPage(p.n)} aria-label={`Page ${p.n}: ${p.heading}`}>
            <span className="eb-pdf-thumb" aria-hidden="true">{p.lines.slice(0, 4).map((l, i) => <i key={i} style={{ width: `${40 + (l.length % 5) * 12}%` }} />)}</span>
            <span className="eb-mono">{p.n}</span>
          </button>
        ))}
      </nav>
      <div>
        <form className="eb-row" style={{ gap: 6, marginBottom: 8 }} role="search" onSubmit={(e) => { e.preventDefault(); step(1); }}>
          <label className="eb-grow"><span className="visually-hidden">Search in this PDF</span><input className="eb-input" value={query} onChange={(e) => { setQuery(e.target.value); setCursor(0); }} placeholder="Search in this PDF" /></label>
          <span className="eb-note" aria-live="polite">{query.trim().length >= 2 ? `${hits.length ? cursor + 1 : 0} / ${hits.length}` : ""}</span>
          <PillButton tone="outline" size="sm" type="button" onClick={() => step(-1)} disabled={!hits.length}>Prev</PillButton>
          <PillButton tone="outline" size="sm" type="submit" disabled={!hits.length}>Next</PillButton>
        </form>
        <div className="eb-pdf-page" ref={ref} role="document" aria-label={`Page ${current.n}: ${current.heading}`}>
          <h3 className="eb-h">{current.heading}</h3>
          {current.lines.map((line, i) => {
            const spans = [
              ...pageHits.filter((h) => h.line === i).map((h) => ({ start: h.start, end: h.end })),
              ...(current.marks ?? []).filter((m) => m.line === i).map((m) => ({ start: m.start, end: m.end })),
            ];
            const isCurrent = hits[cursor]?.page === current.n && hits[cursor]?.line === i;
            return (
              <p key={i} className="eb-body" style={{ margin: "0 0 6px" }} data-current={isCurrent || undefined}>
                {splitRuns(line, spans).map((r, k) => (r.mark ? <mark key={k} className="eb-hl">{r.text}</mark> : r.text))}
              </p>
            );
          })}
          {bbox ? (
            <div
              className="eb-bbox"
              role="img"
              aria-label={`Parser region on page ${current.n}${locator?.parser ? ` (${locator.parser})` : ""}`}
              style={{ left: `${bbox.x0 * 100}%`, top: `${bbox.y0 * 100}%`, width: `${(bbox.x1 - bbox.x0) * 100}%`, height: `${(bbox.y1 - bbox.y0) * 100}%` }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
