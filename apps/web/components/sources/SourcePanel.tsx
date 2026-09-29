"use client";
// Owner task: EB-50 Ask Brain UI — side sheet that opens a citation at the exact supporting span.
// Uses @klarity/ui Sheet (native <dialog>): Esc closes, focus is trapped and returns to the opener.
import { Badge, formatDateTime, Icon, Sheet } from "@klarity/ui";

import { SOURCE_META } from "@/lib/sources";
import type { Evidence } from "@/lib/contracts";

export function SourcePanel({
  evidence,
  citedFor,
  onClose,
}: {
  evidence: Evidence | null;
  citedFor: string[];
  onClose: () => void;
}) {
  const meta = evidence ? SOURCE_META[evidence.sourceType] : null;
  const { start, end } = evidence?.highlight ?? { start: 0, end: 0 };
  return (
    <Sheet open={Boolean(evidence)} onClose={onClose} labelledBy="source-title">
      {evidence && meta ? (
        <>
          <div>
            <Badge icon={meta.icon}>{meta.label}</Badge>
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
            <figcaption>The highlighted passage is what the figure or answer relies on.</figcaption>
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
        </>
      ) : null}
    </Sheet>
  );
}
