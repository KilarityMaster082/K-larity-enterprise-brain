// Owner task: EB-103 Communications hub — pure helpers for the email composer: the AI draft suggestion built from what
// the extractor found in the thread, and the toolbar's text transforms. The suggestion only proposes text; the person
// accepts or dismisses it, and sending goes through Approvals (CLAUDE.md rule 10).
import type { MailThread } from "./data/types";

export function suggestDraft(t: Pick<MailThread, "subject" | "extraction">): string {
  const next = [...t.extraction.commitments].sort((a, b) => a.due.localeCompare(b.due))[0];
  const ref = t.subject.match(/\b[A-Z]{2,5}-\d+\b/)?.[0];
  const parts: string[] = [];
  if (next) parts.push(`add the date for “${next.text.toLowerCase()}” (${next.due})`);
  if (ref) parts.push(`reference ${ref}`);
  return parts.length ? `AI draft: ${parts.join(" and ")}.` : "";
}

export function suggestionSentence(t: Pick<MailThread, "subject" | "extraction">): string {
  const next = [...t.extraction.commitments].sort((a, b) => a.due.localeCompare(b.due))[0];
  const ref = t.subject.match(/\b[A-Z]{2,5}-\d+\b/)?.[0];
  return [next ? `We will ${next.text.charAt(0).toLowerCase()}${next.text.slice(1)} by ${next.due}.` : "", ref ? `Reference: ${ref}.` : ""].filter(Boolean).join(" ");
}

export type Format = "bold" | "italic" | "list" | "quote" | "link";

/** Applies a toolbar action to a text selection; returns the new text and the new selection range. */
export function applyFormat(text: string, start: number, end: number, f: Format): { text: string; start: number; end: number } {
  const sel = text.slice(start, end);
  const wrap = (l: string, r: string, placeholder: string) => {
    const inner = sel || placeholder;
    return { text: text.slice(0, start) + l + inner + r + text.slice(end), start: start + l.length, end: start + l.length + inner.length };
  };
  if (f === "bold") return wrap("**", "**", "bold");
  if (f === "italic") return wrap("_", "_", "italic");
  if (f === "link") return wrap("[", "](https://)", "link text");
  const prefix = f === "list" ? "- " : "> ";
  const from = text.lastIndexOf("\n", start - 1) + 1;
  const chunk = text.slice(from, end || start);
  const block = (chunk || "").split("\n").map((l) => (l.startsWith(prefix) ? l : prefix + l)).join("\n");
  return { text: text.slice(0, from) + block + text.slice(end || start), start: from + prefix.length, end: from + block.length };
}
