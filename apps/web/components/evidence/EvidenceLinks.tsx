"use client";
// Owner task: EB-97 Shared data components — "where did this come from?" on any page: one chip per source;
// each opens the Evidence Side-Sheet at the exact supporting passage. Pages pass only evidence of their own tenant;
// the sheet re-checks the caller's role on the server before showing anything sensitive.
import { Icon } from "@klarity/ui";

import { useOverlay } from "@/components/overlays/useOverlay";
import { useTenantId } from "@/components/shell/TenantContext";
import type { Evidence } from "@/lib/contracts";
import { rememberEvidence } from "@/lib/evidence-cache";
import { SOURCE_META } from "@/lib/sources";

export function EvidenceLinks({ evidence, citedFor = [], compact }: { evidence: Evidence[]; citedFor?: string[]; compact?: boolean }) {
  const open = useOverlay();
  const tenantId = useTenantId();
  if (!evidence.length) return null;
  return (
    <span className="eb-row" style={{ gap: 5 }}>
      {evidence.map((e, i) => {
        const meta = SOURCE_META[e.sourceType];
        return (
          <button
            key={e.id}
            type="button"
            className="eb-pill"
            data-tone="outline"
            data-size="sm"
            onClick={() => {
              rememberEvidence(tenantId, { evidence: e, citedFor, number: i + 1 });
              open("source", e.id);
            }}
            aria-label={`View source: ${e.title}`}
            title={e.title}
          >
            <Icon name={meta.icon} size={11} />
            {compact ? meta.label : e.title.length > 34 ? `${e.title.slice(0, 32)}…` : e.title}
          </button>
        );
      })}
    </span>
  );
}
