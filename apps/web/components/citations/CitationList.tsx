// Owner task: EB-50 Ask Brain UI — numbered list of the sources behind an answer.
"use client";

import type { Evidence, SourceType } from "@/lib/contracts";
import { formatDateTime } from "@/lib/format";

import { Icon } from "../ui/Icon";

export const SOURCE_META: Record<SourceType, { icon: string; label: string }> = {
  email: { icon: "mail", label: "Email" },
  whatsapp: { icon: "chat", label: "WhatsApp" },
  sheet: { icon: "sheet", label: "Sheet" },
  document: { icon: "documents", label: "Document" },
  drawing: { icon: "drawing", label: "Drawing" },
  meeting: { icon: "chat", label: "Meeting" },
};

export default function CitationList({ evidence, onOpen }: { evidence: Evidence[]; onOpen: (e: Evidence) => void }) {
  if (!evidence.length) return null;
  return (
    <section className="answer-section" aria-label="Sources">
      <h3>Sources</h3>
      <ol className="sources">
        {evidence.map((e, i) => {
          const meta = SOURCE_META[e.sourceType];
          return (
            <li key={e.id}>
              <button type="button" className="source-row" onClick={() => onOpen(e)}>
                <span className="source-num">{i + 1}</span>
                <span className="source-icon" title={meta.label}>
                  <Icon name={meta.icon} size={16} />
                </span>
                <span className="source-main">
                  <span className="source-title">{e.title}</span>
                  <span className="source-sub">
                    {meta.label}
                    {e.author ? ` · ${e.author}` : ""}
                    {e.occurredAt ? ` · ${formatDateTime(e.occurredAt)}` : ""}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
