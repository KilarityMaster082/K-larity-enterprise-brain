"use client";
// Owner task: EB-57 Documents view — filter bar and card grid (screen 15). A card opens the file viewer over this page.
import { Bento, Grid, Pill, PillButton } from "@klarity/ui";
import { useMemo, useState } from "react";

import { useOverlay } from "@/components/overlays/useOverlay";
import type { Evidence } from "@/lib/contracts";
import type { DocumentItem } from "@/lib/data/types";

export interface DocRow extends DocumentItem {
  projectName: string;
  ext: string;
  evidence: Evidence[];
}

const TYPE_LABEL: Record<DocumentItem["docType"], string> = {
  drawing: "Drawing",
  quotation: "Quotation",
  invoice: "Invoice",
  report: "Report",
  contract: "Contract",
  minutes: "Minutes",
};
const TONE: Record<DocumentItem["docType"], "sky" | "lavender" | "green" | "pink" | "cream" | "lime"> = {
  drawing: "sky",
  quotation: "green",
  invoice: "pink",
  report: "cream",
  contract: "lavender",
  minutes: "lime",
};

export function DocumentsView({ rows, projects, initialProject, initialQuery }: { rows: DocRow[]; projects: { id: string; name: string }[]; initialProject?: string; initialQuery?: string }) {
  const open = useOverlay();
  const [q, setQ] = useState(initialQuery ?? "");
  const [project, setProject] = useState(initialProject && projects.some((p) => p.id === initialProject) ? initialProject : "all");
  const [type, setType] = useState<string>("all");
  const [latestOnly, setLatestOnly] = useState(true);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => (latestOnly ? r.isLatest : true))
      .filter((r) => project === "all" || r.projectId === project)
      .filter((r) => type === "all" || r.docType === type)
      .filter((r) => !needle || [r.title, r.series, r.summary, r.projectName, r.fileName, ...r.facts].some((x) => x?.toLowerCase().includes(needle)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [rows, q, project, type, latestOnly]);

  return (
    <Bento tone="strong" aria-label="Documents">
      <div className="eb-row" role="search" aria-label="Filter documents" style={{ marginBottom: 12 }}>
        <label className="visually-hidden" htmlFor="doc-project">Project</label>
        <select id="doc-project" className="eb-input" style={{ width: "auto" }} value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="all">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label className="visually-hidden" htmlFor="doc-type">Type</label>
        <select id="doc-type" className="eb-input" style={{ width: "auto" }} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">Type: All</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <PillButton active={latestOnly} aria-pressed={latestOnly} onClick={() => setLatestOnly((v) => !v)}>
          Latest revision only
        </PillButton>
        <span className="eb-note dim" role="status">
          {shown.length} document{shown.length === 1 ? "" : "s"}
        </span>
        <label className="eb-search eb-auto" style={{ width: 240 }}>
          <span className="visually-hidden">Search sheets and specs</span>
          <input type="search" placeholder="Search sheets and specs…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      {shown.length ? (
        <Grid cols="repeat(3, minmax(0, 1fr))" align="stretch">
          {shown.map((d) => (
            <Bento key={d.documentId} tone={TONE[d.docType]} fill className="eb-doc" style={{ borderRadius: 18, minHeight: 110 }} aria-label={d.title}>
              <div className="eb-row" style={{ justifyContent: "space-between" }}>
                <Pill tone="mono">{d.ext}</Pill>
                {d.revision ? <Pill tone={d.isLatest ? "black" : "outline"} size="sm">{d.isLatest ? `Rev ${d.revision}` : `Rev ${d.revision} · superseded`}</Pill> : !d.isLatest ? <Pill size="sm" tone="outline">Superseded</Pill> : null}
              </div>
              <div>
                <h3 className="eb-h-lg" style={{ fontSize: "var(--eb-t-md)" }}>
                  <button type="button" className="eb-linklike eb-stretched" onClick={() => open("view", d.documentId)}>
                    {d.series ? `${d.series} ` : ""}
                    {d.title}
                  </button>
                </h3>
                <div className="eb-row" style={{ marginTop: 6, gap: 5 }}>
                  <Pill tone="outline" size="sm">{TYPE_LABEL[d.docType]}</Pill>
                  <Pill tone="outline" size="sm">{d.projectName}</Pill>
                  {d.signed === false ? <Pill tone="pink" size="sm">Not signed</Pill> : null}
                </div>
              </div>
            </Bento>
          ))}
        </Grid>
      ) : (
        <p className="eb-body" role="status">No documents match. Try another word, a sheet number such as PHX-STR-204, or turn off “Latest revision only”.</p>
      )}
    </Bento>
  );
}
