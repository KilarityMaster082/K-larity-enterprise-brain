// Owner task: EB-23 Web UI shell — small server-safe building blocks shared by the Brain pages.
import { Badge, EmptyState } from "@klarity/ui";
import Link from "next/link";

import type { Health } from "@/lib/data/derive";

export function NoAccess({ what }: { what: string }) {
  return (
    <div className="content">
      <EmptyState icon="lock" title={`You don't have access to ${what}`}>
        <p>Ask a workspace owner if you need it. Access follows your role and the permissions of each source.</p>
      </EmptyState>
    </div>
  );
}

const HEALTH: Record<Health, { label: string; tone: "ok" | "warn" | "danger" }> = {
  on_track: { label: "On track", tone: "ok" },
  at_risk: { label: "At risk", tone: "warn" },
  off_track: { label: "Off track", tone: "danger" },
};

export function HealthBadge({ health }: { health: Health }) {
  const h = HEALTH[health];
  return (
    <Badge tone={h.tone}>
      <span className={`health-dot health-${health}`} aria-hidden="true" />
      {h.label}
    </Badge>
  );
}

/** Empty state for a workspace whose sources have not finished their first sync. */
export function NotSyncedYet({ what }: { what: string }) {
  return (
    <EmptyState
      icon="plug"
      title={`No ${what} yet`}
      action={
        <Link className="btn btn-primary" href="/settings?tab=sources">
          Connect a source
        </Link>
      }
    >
      <p>
        {what[0]!.toUpperCase() + what.slice(1)} appear here once a source (Gmail, Drive, Sheets or a WhatsApp export) is
        connected and its first sync finishes.
      </p>
    </EmptyState>
  );
}
