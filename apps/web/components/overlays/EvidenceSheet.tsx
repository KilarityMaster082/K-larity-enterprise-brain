"use client";
// Owner task: EB-50 Ask Brain UI — the Evidence & Source Side-Sheet (screen 2). Opens from any citation chip
// ([E1], [E2] …) or a ?source=<id> link; shows the verbatim passage with the exact supporting span highlighted,
// where it sits in the original file (page, Docling TableFormer box and cell range), and the source's metadata with
// timestamps in IST. Esc closes and focus returns to the chip that opened it (native <dialog> in @klarity/ui Sheet).
import { Highlighted, Icon, Pill, Sheet, formatDateTime } from "@klarity/ui";
import { useEffect, useState } from "react";

import type { Evidence } from "@/lib/contracts";
import { recallEvidence } from "@/lib/evidence-cache";
import { SOURCE_META } from "@/lib/sources";

type State = { kind: "loading" } | { kind: "ready"; evidence: Evidence; citedFor: string[]; number?: number } | { kind: "error"; message: string };

const OPEN_LABEL: Record<string, string> = { email: "Gmail", whatsapp: "WhatsApp", sheet: "Sheets", document: "Drive", drawing: "Drive", meeting: "Calendar" };

export function EvidenceSheet({ id, tenantId, onClose }: { id: string | null; tenantId: string; onClose: () => void }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!id) return;
    const hit = recallEvidence(tenantId, id);
    if (hit) {
      setState({ kind: "ready", evidence: hit.evidence, citedFor: hit.citedFor, number: hit.number });
      return;
    }
    setState({ kind: "loading" });
    const ctl = new AbortController();
    fetch(`/api/evidence/${encodeURIComponent(id)}`, { signal: ctl.signal })
      .then(async (r) => {
        if (r.ok) return ((await r.json()) as { evidence: Evidence }).evidence;
        throw new Error(r.status === 403 ? "Your role cannot open this source." : r.status === 404 ? "This source is not available in this workspace." : "The source could not be loaded.");
      })
      .then((evidence) => setState({ kind: "ready", evidence, citedFor: [] }))
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setState({ kind: "error", message: e instanceof Error ? e.message : "The source could not be loaded." });
      });
    return () => ctl.abort();
  }, [id, tenantId]);

  return (
    <Sheet open={Boolean(id)} onClose={onClose} labelledBy="evidence-title">
      {state.kind === "loading" ? (
        <p role="status" className="eb-dim">
          Loading source…
        </p>
      ) : state.kind === "error" ? (
        <p role="alert">
          <Icon name="lock" size={14} /> {state.message}
        </p>
      ) : (
        <EvidenceBody evidence={state.evidence} citedFor={state.citedFor} number={state.number} />
      )}
    </Sheet>
  );
}

function EvidenceBody({ evidence: e, citedFor, number }: { evidence: Evidence; citedFor: string[]; number?: number }) {
  const meta = SOURCE_META[e.sourceType];
  const h = e.highlight;
  const loc = e.locator;
  const openLabel = OPEN_LABEL[e.sourceType];
  return (
    <div className="eb-stack" style={{ gap: 11 }}>
      <div>
        <span className="eb-source-badge">
          {meta.label} · {number ? `Source ${number}` : "Source"}
        </span>
      </div>
      <h2 id="evidence-title" style={{ fontSize: "var(--eb-t-xl)", lineHeight: 1.2 }}>
        {e.title}
      </h2>
      <p className="eb-note dim" style={{ fontSize: "var(--eb-t-xs)" }}>
        {[e.author, e.occurredAt ? `${formatDateTime(e.occurredAt)} IST` : null, e.project].filter(Boolean).join(" · ")}
      </p>

      <p className="eb-passage" data-testid="evidence-passage">
        {h ? <Highlighted text={e.excerpt} start={h.start} end={h.end} /> : e.excerpt}
      </p>
      {h ? <p className="eb-note dim">The highlighted passage is what the answer relies on.</p> : null}

      {loc ? <Locator evidence={e} /> : null}

      {citedFor.length ? (
        <section className="eb-stack tight" aria-label="Used to support">
          <h3 className="eb-h">Used to support</h3>
          {citedFor.map((c) => (
            <div key={c} className="eb-bento" data-tone="lime" style={{ padding: "8px 10px", borderRadius: 11 }}>
              {c}
            </div>
          ))}
        </section>
      ) : null}

      <div style={{ marginTop: "auto" }}>
        {e.openUrl ? (
          <a className="eb-pill" data-tone="black" data-size="lg" style={{ justifyContent: "center", width: "100%" }} href={e.openUrl} target="_blank" rel="noopener noreferrer">
            Open in {openLabel ?? meta.label} <Icon name="external" size={13} />
          </a>
        ) : (
          <button type="button" className="eb-pill" data-tone="black" data-size="lg" disabled style={{ justifyContent: "center", width: "100%" }} title="Demo data has no original to open">
            Open in {openLabel ?? meta.label} ↗ <span className="visually-hidden">(not linked in demo data)</span>
          </button>
        )}
      </div>
    </div>
  );
}

/** Page thumbnail with the recognised box drawn over it, plus the table reference TableFormer recorded. */
function Locator({ evidence: e }: { evidence: Evidence }) {
  const loc = e.locator!;
  const b = loc.bbox;
  return (
    <section className="eb-stack tight" aria-label="Location in the original">
      <div className="eb-row" style={{ justifyContent: "space-between" }}>
        <h3 className="eb-h">Where it sits</h3>
        <span className="eb-row">
          {loc.parser ? <Pill tone="mono">{loc.parser === "docling" ? "Docling" : loc.parser}</Pill> : null}
          {loc.page ? <Pill size="sm">Page {loc.page}</Pill> : null}
        </span>
      </div>
      {b ? (
        <div className="eb-doc-page" style={{ aspectRatio: "210 / 297", maxWidth: 210 }} role="img" aria-label={`Page ${loc.page ?? 1} with the supporting region outlined`}>
          <div className="eb-placeholder" style={{ position: "absolute", inset: 6, minHeight: 0 }} aria-hidden="true" />
          <div className="eb-bbox" data-testid="evidence-bbox" style={{ left: `${b.x0 * 100}%`, top: `${b.y0 * 100}%`, width: `${(b.x1 - b.x0) * 100}%`, height: `${(b.y1 - b.y0) * 100}%` }} />
        </div>
      ) : null}
      {loc.table ? (
        <p className="eb-note" data-testid="evidence-table">
          <Icon name="table" size={12} /> Table <span className="eb-mono">{loc.table.tableId}</span>
          {loc.table.caption ? ` · ${loc.table.caption}` : ""} · {loc.table.rowStart === loc.table.rowEnd ? `row ${loc.table.rowStart + 1}` : `rows ${loc.table.rowStart + 1}–${loc.table.rowEnd + 1}`}
          {loc.table.colEnd !== undefined ? `, columns ${(loc.table.colStart ?? 0) + 1}–${loc.table.colEnd + 1}` : ""}
        </p>
      ) : null}
    </section>
  );
}
