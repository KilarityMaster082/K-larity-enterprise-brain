// Owner task: EB-102 File viewers — which viewer opens a document (screens 30–37), decided by the file name's extension,
// falling back to the document type (drawings, quotations and reports are exported PDFs).
import type { DocumentItem } from "./data/types";

export type ViewerKind = "xlsx" | "pdf" | "docx" | "pptx" | "image" | "video" | "audio" | "code";

const BY_EXT: Record<string, ViewerKind> = {
  xlsx: "xlsx", xls: "xlsx", csv: "xlsx", tsv: "xlsx",
  pdf: "pdf",
  docx: "docx", doc: "docx",
  pptx: "pptx", ppt: "pptx",
  jpg: "image", jpeg: "image", png: "image", webp: "image", heic: "image",
  mp4: "video", mov: "video", webm: "video",
  m4a: "audio", mp3: "audio", wav: "audio", ogg: "audio", opus: "audio",
  json: "code", yaml: "code", yml: "code", diff: "code", patch: "code", py: "code", ts: "code", sql: "code",
};

/** Screen number of each viewer in SCREENS_CATALOG.md. */
export const VIEWER_SCREEN: Record<ViewerKind, number> = { xlsx: 30, pdf: 31, docx: 32, pptx: 33, image: 34, video: 35, audio: 36, code: 37 };

export function extOf(fileName: string | undefined): string {
  const m = fileName?.match(/\.([A-Za-z0-9]{1,5})$/);
  return m ? m[1]!.toLowerCase() : "";
}

export function viewerKind(doc: Pick<DocumentItem, "fileName" | "docType">): ViewerKind {
  return BY_EXT[extOf(doc.fileName)] ?? (doc.docType === "minutes" ? "docx" : "pdf");
}

/** The chip printed on a document card: the real extension when known, else the format the parsers exported. */
export function extLabel(doc: Pick<DocumentItem, "fileName" | "docType">): string {
  const e = extOf(doc.fileName);
  return e ? e.toUpperCase() : viewerKind(doc) === "docx" ? "DOCX" : "PDF";
}

/** Code and config files are for technical roles (catalog screen 37: Technical / Admin). */
export function needsTechnicalRole(kind: ViewerKind): boolean {
  return kind === "code";
}
