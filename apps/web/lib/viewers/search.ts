// Owner task: EB-102 File viewers — in-document search for the PDF viewer (screen 31): every case-insensitive match on
// every page, so the viewer can highlight them and jump between pages. Pure, unit-tested in tests/viewers.test.ts.
export interface PdfHit {
  page: number;
  line: number;
  start: number;
  end: number;
}

export function searchPages(pages: { n: number; lines: string[] }[], query: string): PdfHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: PdfHit[] = [];
  for (const p of pages) {
    p.lines.forEach((text, line) => {
      const hay = text.toLowerCase();
      for (let at = hay.indexOf(q); at !== -1; at = hay.indexOf(q, at + q.length)) hits.push({ page: p.n, line, start: at, end: at + q.length });
    });
  }
  return hits;
}

/** Split a line into plain and highlighted runs from a list of [start, end) spans (overlaps are merged). */
export function splitRuns(text: string, spans: { start: number; end: number }[]): { text: string; mark: boolean }[] {
  const sorted = [...spans].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const s of sorted) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  const out: { text: string; mark: boolean }[] = [];
  let at = 0;
  for (const s of merged) {
    if (s.start > at) out.push({ text: text.slice(at, s.start), mark: false });
    out.push({ text: text.slice(s.start, Math.min(s.end, text.length)), mark: true });
    at = Math.min(s.end, text.length);
  }
  if (at < text.length) out.push({ text: text.slice(at), mark: false });
  return out.length ? out : [{ text, mark: false }];
}
