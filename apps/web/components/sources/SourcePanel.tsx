// Owner task: EB-50 Ask Brain UI — side sheet that opens a citation at the exact supporting span.
// Native <dialog>: Esc closes, focus is trapped while open and returns to the citation afterwards.
"use client";

import { useEffect, useRef } from "react";

import { SOURCE_META } from "@/components/citations/CitationList";
import type { Evidence } from "@/lib/contracts";
import { formatDateTime } from "@/lib/format";

import { Icon } from "../ui/Icon";

export function SourcePanel({
  evidence,
  citedFor,
  onClose,
}: {
  evidence: Evidence | null;
  citedFor: string[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (evidence && !d.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      d.showModal();
    }
    if (!evidence && d.open) d.close();
  }, [evidence]);

  const meta = evidence ? SOURCE_META[evidence.sourceType] : null;
  const { start, end } = evidence?.highlight ?? { start: 0, end: 0 };

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="source-title"
      onClose={() => {
        onClose();
        opener.current?.focus(); // return focus to the citation that opened the sheet
      }}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close(); // click on backdrop
      }}
    >
      {evidence && meta ? (
        <div className="sheet-body">
          <div className="sheet-head">
            <span className="badge">
              <Icon name={meta.icon} size={14} /> {meta.label}
            </span>
            <button type="button" className="btn btn-ghost btn-icon" aria-label="Close source" onClick={() => ref.current?.close()}>
              <Icon name="close" />
            </button>
          </div>
          <h2 id="source-title">{evidence.title}</h2>
          <dl className="sheet-meta">
            {evidence.author ? (
              <>
                <dt>From</dt>
                <dd>{evidence.author}</dd>
              </>
            ) : null}
            {evidence.occurredAt ? (
              <>
                <dt>When</dt>
                <dd>{formatDateTime(evidence.occurredAt)} IST</dd>
              </>
            ) : null}
            {evidence.project ? (
              <>
                <dt>Project</dt>
                <dd>{evidence.project}</dd>
              </>
            ) : null}
          </dl>

          <figure className="excerpt">
            <blockquote>
              {evidence.excerpt.slice(0, start)}
              <mark>{evidence.excerpt.slice(start, end)}</mark>
              {evidence.excerpt.slice(end)}
            </blockquote>
            <figcaption>The highlighted passage is what the answer relies on.</figcaption>
          </figure>

          {citedFor.length ? (
            <section className="sheet-section">
              <h3>Used to support</h3>
              <ul>
                {citedFor.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="sheet-foot">
            {evidence.openUrl ? (
              <a className="btn btn-primary" href={evidence.openUrl} target="_blank" rel="noopener noreferrer">
                Open in {meta.label} <Icon name="external" size={16} />
              </a>
            ) : (
              <button type="button" className="btn" disabled title="Demo data has no original to open">
                Open original <Icon name="external" size={16} />
              </button>
            )}
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
