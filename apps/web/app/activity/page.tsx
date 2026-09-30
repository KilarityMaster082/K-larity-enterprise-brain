// Owner task: EB-106 Agents and background jobs — Team Activity Stream (screen 29): what the firm did lately — uploads,
// confirmed decisions, decided approvals and source syncs — newest first. The period control sets the window.
import { Bento, BentoHead, Pill, formatDateTime } from "@klarity/ui";
import type { Metadata } from "next";

import { NoAccess } from "@/components/page/common";
import { Brief, Screen, presenceOf } from "@/components/page/Screen";
import { agentsBrief } from "@/lib/briefs";
import { pageContext } from "@/lib/page";
import { parsePeriod, periodDays } from "@/lib/period";
import { activityFeed, projectName } from "@/lib/workspace";

export const metadata: Metadata = { title: "Activity" };

const TONE = { uploaded: "sky", confirmed: "lime", approved: "green", synced: "lavender", rejected: "pink", joined: "cream", commented: "outline" } as const;

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const ctx = await pageContext("/activity", "activity.view");
  if (!ctx.allowed) return <NoAccess what="the activity stream" />;
  const sp = await searchParams;
  const days = periodDays(parsePeriod(sp.period));
  const { view, session } = ctx;
  const items = activityFeed(view, days);
  return (
    <Screen n={29} brief={<Brief metrics={agentsBrief(view)} live={presenceOf(view.members, session.user)} />}>
      <Bento tone="strong" aria-label="Activity">
        <BentoHead title={`Last ${days} days`} aside={<Pill size="sm" tone="outline">{items.length} events</Pill>} />
        {items.length === 0 ? <p className="eb-body">Nothing happened in this period.</p> : (
          <ul className="eb-timeline">
            {items.map((i) => (
              <li key={i.id}>
                <time className="eb-mono eb-dim" dateTime={i.at}>{formatDateTime(i.at)}</time>
                <span className="eb-grow"><b>{i.actor}</b> {i.verb} <span>{i.target}</span>{i.projectId ? <span className="eb-dim"> · {projectName(view, i.projectId)}</span> : null}</span>
                <Pill size="sm" tone={TONE[i.verb]}>{i.verb}</Pill>
              </li>
            ))}
          </ul>
        )}
      </Bento>
    </Screen>
  );
}
