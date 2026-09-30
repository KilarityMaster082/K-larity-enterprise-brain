// Owner task: EB-23 Web UI shell — the frame every screen sits in: the "N / 54 · title · role · status" crumb, the
// group's brief row (three pastel metrics and the Live card) and the content with the handoff's fade-up entrance.
import { Metric, LiveCard, ScreenCrumb, Sparkline } from "@klarity/ui";
import type { ReactNode } from "react";

import type { BriefMetric } from "@/lib/briefs";
import type { Member } from "@/lib/data/types";
import { crumb } from "@/lib/screens";

/** Teammates seen in the last 15 minutes (plus the viewer), for the Live card. */
export function presenceOf(members: Member[], me: { name: string }, now = Date.now()): { label: string; tone?: "lime" | "sky" | "pink" }[] {
  const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  const tones = ["lime", "sky", "pink"] as const;
  const recent = members.filter((m) => m.status === "active" && m.lastActiveAt && now - new Date(m.lastActiveAt).getTime() < 15 * 60_000);
  const labels = [initials(me.name), ...recent.map((m) => initials(m.name)).filter((l) => l && l !== initials(me.name))];
  return labels.slice(0, 3).map((label, i) => ({ label, tone: tones[i] }));
}

export function Brief({ metrics, live }: { metrics: BriefMetric[]; live: { label: string; tone?: "lime" | "sky" | "pink" }[] }) {
  return (
    <div className="eb-brief" role="region" aria-label="Summary">
      {metrics.slice(0, 3).map((m) => (
        <Metric key={m.label} label={m.label} value={m.value} note={m.note} tone={m.tone} spark={m.series && m.series.length > 1 ? <Sparkline series={m.series} /> : undefined} />
      ))}
      <LiveCard people={live} count={live.length} />
    </div>
  );
}

export function Screen({ n, brief, children }: { n: number; brief?: ReactNode; children: ReactNode }) {
  return (
    <>
      <ScreenCrumb {...crumb(n)} />
      {brief}
      <div className="eb-enter">{children}</div>
    </>
  );
}
