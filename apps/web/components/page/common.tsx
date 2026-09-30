// Owner task: EB-23 Web UI shell — small server-safe building blocks shared by the Brain pages, in the handoff's
// bento style: no-access and empty states, and the project health pill.
import { Bento, Icon, Pill, PillLink } from "@klarity/ui";

import type { Health } from "@/lib/data/derive";

export function NoAccess({ what }: { what: string }) {
  return (
    <Bento tone="cream" pad="lg" role="alert" aria-label="No access" className="eb-stack" style={{ maxWidth: 560 }}>
      <h1 className="eb-h-lg">
        <Icon name="lock" size={15} /> You don&apos;t have access to {what}
      </h1>
      <p className="eb-body">Ask a workspace owner if you need it. Access follows your role and the permissions of each source.</p>
      <div>
        <PillLink tone="black" href="/ask">
          Back to Ask Brain
        </PillLink>
      </div>
    </Bento>
  );
}

const HEALTH: Record<Health, { label: string; tone: "black" | "default" | "lime" }> = {
  on_track: { label: "On track", tone: "lime" },
  at_risk: { label: "At risk", tone: "default" },
  off_track: { label: "Off track", tone: "black" },
};

export function HealthBadge({ health }: { health: Health }) {
  const h = HEALTH[health];
  return (
    <Pill tone={h.tone} title={`Project health: ${h.label}`}>
      {h.label}
    </Pill>
  );
}

/** Empty state for a workspace whose sources have not finished their first sync. */
export function NotSyncedYet({ what, canConnect = true }: { what: string; canConnect?: boolean }) {
  return (
    <Bento tone="sky" pad="lg" className="eb-stack" style={{ maxWidth: 620 }} aria-label={`No ${what} yet`}>
      <h1 className="eb-h-lg">
        <Icon name="plug" size={15} /> No {what} yet
      </h1>
      <p className="eb-body">
        {what[0]!.toUpperCase() + what.slice(1)} appear here once a source (Gmail, Drive, Sheets or a WhatsApp export) is connected and its first sync finishes.
      </p>
      {canConnect ? (
        <div>
          <PillLink tone="black" href="/onboarding">
            Connect a source
          </PillLink>
        </div>
      ) : null}
    </Bento>
  );
}
