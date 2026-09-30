"use client";
// Owner task: EB-102 File viewers — the viewer overlay for screens 30–37 (?view=<documentId>). Fetches GET /api/files/[id]
// (tenant- and role-checked, money redacted), renders the right viewer and, beside it, the details sidebar: summary, facts,
// revision history and the evidence it came from. Opening a citation's file lands on the cited page with its bounding box.
import { Icon, Pill, Sheet, formatDate } from "@klarity/ui";
import { useEffect, useState } from "react";

import type { FilePayload } from "@/lib/viewers/read";

import { CodeViewer } from "../viewers/CodeViewer";
import { DocxViewer, PptxViewer } from "../viewers/DocViewers";
import { AudioViewer, ImageViewer, VideoViewer } from "../viewers/MediaViewers";
import { PdfViewer } from "../viewers/PdfViewer";
import { SheetViewer } from "../viewers/SheetViewer";
import { useOverlay } from "./useOverlay";

const LABEL = { xlsx: "Spreadsheet", pdf: "PDF", docx: "Document", pptx: "Slides", image: "Photo", video: "Video", audio: "Voice note", code: "Code diff" } as const;

export function FileViewer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [file, setFile] = useState<FilePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = useOverlay();

  useEffect(() => {
    if (!id) return;
    setFile(null);
    setError(null);
    const ctl = new AbortController();
    fetch(`/api/files/${encodeURIComponent(id)}`, { signal: ctl.signal })
      .then(async (r) => {
        if (r.status === 403) throw new Error(((await r.json().catch(() => ({}))) as { reason?: string }).reason ?? "Your role cannot open this file.");
        if (!r.ok) throw new Error("This file is not available.");
        return (await r.json()) as FilePayload;
      })
      .then(setFile)
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : "This file is not available.");
      });
    return () => ctl.abort();
  }, [id]);

  const c = file?.content;
  return (
    <Sheet open={Boolean(id)} onClose={onClose} wide labelledBy="file-title">
      {error ? (
        <p role="alert"><Icon name="lock" size={14} /> {error}</p>
      ) : !file ? (
        <p role="status" className="eb-dim">Opening the file…</p>
      ) : (
        <div className="eb-stack">
          <div>
            <p className="eb-eyebrow">{file.screen} / 54 · {LABEL[file.kind]}</p>
            <h2 id="file-title" className="eb-h-lg">{file.doc.title}</h2>
            <p className="eb-note">{file.doc.fileName ?? file.doc.docType} · {file.doc.project} · updated {formatDate(file.doc.updatedAt)}</p>
          </div>
          {file.redacted ? <p className="eb-note" role="note"><Icon name="lock" size={12} /> Amounts are hidden for your role.</p> : null}
          <div className="eb-viewer-grid">
            <div>
              {!c ? <p className="eb-body">A preview of this file has not been parsed yet. The summary and facts on the right come from the source.</p>
                : c.kind === "xlsx" ? <SheetViewer content={c} />
                : c.kind === "pdf" ? <PdfViewer content={c} locator={file.evidence?.locator} />
                : c.kind === "docx" ? <DocxViewer content={c} />
                : c.kind === "pptx" ? <PptxViewer content={c} />
                : c.kind === "image" ? <ImageViewer content={c} />
                : c.kind === "video" ? <VideoViewer content={c} />
                : c.kind === "audio" ? <AudioViewer content={c} />
                : <CodeViewer content={c} />}
            </div>
            <aside aria-label="Details" className="eb-stack" style={{ gap: 12 }}>
              <section><h3 className="eb-h">Summary</h3><p className="eb-body">{file.summary}</p></section>
              {file.facts.length ? <section><h3 className="eb-h">Facts</h3><ul className="eb-doc-list">{file.facts.map((f) => <li key={f}>{f}</li>)}</ul></section> : null}
              {file.revisions.length > 1 ? (
                <section>
                  <h3 className="eb-h">Revisions</h3>
                  <ul className="eb-list">
                    {file.revisions.map((r) => (
                      <li key={r.id}>
                        <button type="button" className="eb-li" disabled={r.id === file.doc.id} onClick={() => open("view", r.id)} aria-current={r.id === file.doc.id ? "true" : undefined}>
                          <span className="eb-li-title eb-grow">Rev {r.revision}</span>
                          <span className="eb-mono eb-dim">{formatDate(r.updatedAt)}</span>
                          {r.isLatest ? <Pill size="sm" tone="lime">Latest</Pill> : <Pill size="sm" tone="outline">Superseded</Pill>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {file.evidence ? (
                <section>
                  <h3 className="eb-h">Evidence</h3>
                  <button type="button" className="eb-pill" data-tone="outline" data-size="sm" onClick={() => open("source", file.evidence!.id)}>Open in the Evidence Side-Sheet</button>
                </section>
              ) : null}
            </aside>
          </div>
        </div>
      )}
    </Sheet>
  );
}
