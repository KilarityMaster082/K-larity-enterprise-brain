"use client";
// Owner task: EB-97 Shared data components — "where did this come from?" on any page: one chip per source;
// each opens the source sheet at the exact supporting passage. Pages pass only evidence of their own tenant.
import { Icon } from "@klarity/ui";
import { useState } from "react";

import { SOURCE_META } from "@/lib/sources";
import { SourcePanel } from "@/components/sources/SourcePanel";
import type { Evidence } from "@/lib/contracts";

export function EvidenceLinks({
  evidence,
  citedFor = [],
  compact,
}: {
  evidence: Evidence[];
  citedFor?: string[];
  compact?: boolean;
}) {
  const [open, setOpen] = useState<Evidence | null>(null);
  if (!evidence.length) return null;
  return (
    <>
      <span className="evidence-links">
        {evidence.map((e) => {
          const meta = SOURCE_META[e.sourceType];
          return (
            <button
              key={e.id}
              type="button"
              className="source-tag"
              onClick={() => setOpen(e)}
              aria-label={`View source: ${e.title}`}
              title={e.title}
            >
              <Icon name={meta.icon} size={12} />
              {compact ? meta.label : e.title.length > 38 ? `${e.title.slice(0, 36)}…` : e.title}
            </button>
          );
        })}
      </span>
      <SourcePanel evidence={open} citedFor={citedFor} onClose={() => setOpen(null)} />
    </>
  );
}
