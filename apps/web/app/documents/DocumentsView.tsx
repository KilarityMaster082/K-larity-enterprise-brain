"use client";
// Owner task: EB-57 Documents view — search, filters, list and preview panel.
import { Badge, Card, EmptyState, formatDate, formatDateTime, Icon, Money, type IconName } from "@klarity/ui";
import { useMemo, useState } from "react";

import { EvidenceLinks } from "@/components/evidence/EvidenceLinks";
import type { Evidence } from "@/lib/contracts";
import type { DocumentItem } from "@/lib/data/types";

export interface DocRow extends DocumentItem {
  projectName: string;
  evidence: Evidence[];
}

const TYPE: Record<DocumentItem["docType"], { label: string; icon: IconName }> = {
  drawing: { label: "Drawing", icon: "drawing" },
  quotation: { label: "Quotation", icon: "finance" },
  invoice: { label: "Invoice", icon: "finance" },
  report: { label: "Report", icon: "documents" },
  contract: { label: "Contract / variation", icon: "shield" },
  minutes: { label: "Minutes", icon: "chat" },
};

const SOURCE: Record<DocumentItem["source"], string> = {
  drive: "Google Drive",
  gmail: "Gmail",
  whatsapp: "WhatsApp",
  sheets: "Google Sheets",
  file_drop: "File drop",
};

function size(bytes: number): string {
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

export function DocumentsView({
  rows,
  projects,
  initialDoc,
  initialProject,
  initialQuery,
}: {
  rows: DocRow[];
  projects: { id: string; name: string }[];
  initialDoc?: string;
  initialProject?: string;
  initialQuery?: string;
}) {
  const initial = rows.find((r) => r.documentId === initialDoc);
  const [q, setQ] = useState(initialQuery ?? "");
  const [project, setProject] = useState(initialProject && projects.some((p) => p.id === initialProject) ? initialProject : "all");
  const [type, setType] = useState<string>("all");
  const [latestOnly, setLatestOnly] = useState(!initial || initial.isLatest);
  const [selected, setSelected] = useState<string | undefined>(initial?.documentId);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => (latestOnly ? r.isLatest : true))
      .filter((r) => project === "all" || r.projectId === project)
      .filter((r) => type === "all" || r.docType === type)
      .filter((r) => !needle || [r.title, r.series, r.summary, r.projectName, ...r.facts].some((x) => x?.toLowerCase().includes(needle)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [rows, q, project, type, latestOnly]);

  const current = rows.find((r) => r.documentId === selected) ?? shown[0];
  const history = current?.series ? rows.filter((r) => r.series === current.series).sort((a, b) => (b.revision ?? "").localeCompare(a.revision ?? "")) : [];

  return (
    <div className="stack">
      <div className="row" role="search" aria-label="Filter documents">
        <input
          type="search"
          className="input input-search"
          style={{ maxWidth: 320 }}
          placeholder="Search titles, sheet numbers, facts"
          aria-label="Search documents"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="select" style={{ width: "auto" }} aria-label="Project" value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="all">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select className="select" style={{ width: "auto" }} aria-label="Type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">All types</option>
          {Object.entries(TYPE).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <label className="row" style={{ fontSize: "var(--fs-sm)", fontWeight: 600 }}>
          <input type="checkbox" checked={latestOnly} onChange={(e) => setLatestOnly(e.target.checked)} /> Latest revisions only
        </label>
        <span className="muted" role="status" style={{ fontSize: "var(--fs-xs)" }}>
          {shown.length} document{shown.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="doc-layout">
        {shown.length ? (
          <ul className="doc-list" aria-label="Documents">
            {shown.map((r) => (
              <li key={r.documentId}>
                <button type="button" className="doc-row" aria-current={current?.documentId === r.documentId} onClick={() => setSelected(r.documentId)}>
                  <span className="doc-icon">
                    <Icon name={TYPE[r.docType].icon} size={18} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span className="doc-title" style={{ display: "block" }}>
                      {r.series ? `${r.series} · ` : ""}
                      {r.title}
                    </span>
                    <span className="doc-sub">
                      {r.projectName} · {TYPE[r.docType].label} · {formatDate(r.updatedAt)}
                    </span>
                  </span>
                  <span className="row">
                    {r.revision ? <Badge tone={r.isLatest ? "solid" : "neutral"}>Rev {r.revision}</Badge> : null}
                    {r.isLatest && r.revision ? <Badge tone="ok">Latest</Badge> : null}
                    {!r.isLatest ? <Badge tone="warn">Superseded</Badge> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon="search" title="No documents match" compact>
            <p>Try another word, a sheet number such as PHX-STR-204, or turn off “Latest revisions only”.</p>
          </EmptyState>
        )}

        {current ? (
          <div className="preview">
            <Card title={current.series ? `${current.series} Rev ${current.revision}` : TYPE[current.docType].label}>
              <div className="stack">
                <h3 style={{ fontSize: "var(--fs-lg)" }}>{current.title}</h3>
                <div className="row">
                  {current.isLatest ? <Badge tone="ok">Latest</Badge> : <Badge tone="warn">Superseded — see the latest below</Badge>}
                  {current.signed === false ? <Badge tone="danger">Not signed</Badge> : null}
                  {current.amount ? <Badge tone="brand"><Money amount={current.amount} /></Badge> : null}
                </div>
                <p>{current.summary}</p>
                {current.facts.length ? (
                  <section>
                    <h4 className="section-title">Extracted facts</h4>
                    <ul className="list-bullets" style={{ marginTop: 6 }}>
                      {current.facts.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                <dl className="kv">
                  <dt>Project</dt>
                  <dd>{current.projectName}</dd>
                  <dt>Source</dt>
                  <dd>{SOURCE[current.source]}</dd>
                  <dt>Updated</dt>
                  <dd>{formatDateTime(current.updatedAt)} IST</dd>
                  <dt>Size</dt>
                  <dd>{size(current.sizeBytes)}</dd>
                </dl>
                {history.length > 1 ? (
                  <section>
                    <h4 className="section-title">Revision history</h4>
                    <ol className="list-plain stack-sm" style={{ marginTop: 6 }}>
                      {history.map((h) => (
                        <li key={h.documentId} className="row-between">
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(h.documentId)} aria-current={h.documentId === current.documentId}>
                            Rev {h.revision}
                          </button>
                          <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                            {formatDate(h.updatedAt)} {h.isLatest ? "· latest" : ""}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </section>
                ) : null}
                <EvidenceLinks evidence={current.evidence} citedFor={current.facts} />
              </div>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
