// Owner task: EB-102 File viewers — the server-side read behind GET /api/files/[id]: tenant-scoped, role-checked, with
// money redacted for roles without finance.view (CLAUDE.md rule 2: permissions again before rendering). Pure given a TenantView.
import type { Evidence } from "../contracts";
import type { TenantView } from "../data/store";
import type { FileContent, Role } from "../data/types";
import { viewerKind, VIEWER_SCREEN, type ViewerKind } from "../files";
import { can } from "../permissions";

export interface FilePayload {
  doc: { id: string; title: string; fileName?: string; docType: string; series?: string; revision?: string; updatedAt: string; sizeBytes: number; project: string; source: string; isLatest: boolean };
  kind: ViewerKind;
  screen: number;
  content: FileContent | null;
  summary: string;
  facts: string[];
  revisions: { id: string; revision: string; updatedAt: string; isLatest: boolean }[];
  evidence?: Evidence;
  /** True when figures were hidden because the role cannot see finance data. */
  redacted: boolean;
}

export type FileAccess = { ok: true; file: FilePayload } | { ok: false; status: 403 | 404; reason?: string };

const MONEY_DOCS = new Set(["quotation", "invoice", "contract"]);
const HIDDEN = "—";

function redactContent(c: FileContent): FileContent {
  if (c.kind !== "xlsx") return c;
  return { ...c, sheets: c.sheets.map((s) => (s.currencyColumns?.length ? { ...s, rows: s.rows.map((r) => r.map((cell, i) => (s.currencyColumns!.includes(i) ? HIDDEN : cell))) } : s)) };
}

export function readFile(view: TenantView, role: Role, id: string): FileAccess {
  if (!can(role, "documents.view")) return { ok: false, status: 403 };
  const doc = view.data.documents.find((d) => d.documentId === id);
  if (!doc) return { ok: false, status: 404 };
  const kind = viewerKind(doc);
  if (kind === "code" && !can(role, "code.view")) return { ok: false, status: 403, reason: "Code and config files are for technical roles." };
  const finance = can(role, "finance.view");
  const ev = view.data.evidence.find((e) => e.id === doc.evidenceId);
  const raw = view.data.workspace.contents[id] ?? null;
  const moneyDoc = MONEY_DOCS.has(doc.docType);
  const redacted = !finance && (moneyDoc || Boolean(raw && raw.kind === "xlsx" && raw.sheets.some((s) => s.currencyColumns?.length)));
  const revisions = doc.series
    ? view.data.documents.filter((d) => d.series === doc.series && d.projectId === doc.projectId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((d) => ({ id: d.documentId, revision: d.revision ?? "—", updatedAt: d.updatedAt, isLatest: d.isLatest }))
    : [];
  const project = view.data.projects.find((p) => p.projectId === doc.projectId)?.name ?? doc.projectId;
  return {
    ok: true,
    file: {
      doc: { id: doc.documentId, title: doc.title, fileName: doc.fileName, docType: doc.docType, series: doc.series, revision: doc.revision, updatedAt: doc.updatedAt, sizeBytes: doc.sizeBytes, project, source: doc.source, isLatest: doc.isLatest },
      kind,
      screen: VIEWER_SCREEN[kind],
      content: raw && !finance && moneyDoc && raw.kind !== "xlsx" ? null : raw ? (finance ? raw : redactContent(raw)) : null,
      summary: doc.summary,
      facts: finance ? doc.facts : doc.facts.filter((f) => !/[₹$]|\bINR\b/.test(f)),
      revisions,
      evidence: ev && !(ev.sourceType === "ledger" || ev.sourceType === "sql") ? ev : undefined,
      redacted,
    },
  };
}
