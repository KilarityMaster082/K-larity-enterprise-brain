// Owner task: EB-93 Settings: connected sources and members — Settings · Connected Sources (screen 43): every source the
// Brain reads, its health, last cursor time, items seen and lag; manual sync, reconnect and disconnect. Credentials are
// encrypted per workspace and never rendered.
import type { Metadata } from "next";

import { NoAccess } from "@/components/page/common";
import { Brief, Screen, presenceOf } from "@/components/page/Screen";
import { appsBrief } from "@/lib/briefs";
import { pageContext } from "@/lib/page";

import { SourcesView } from "./SourcesView";

export const metadata: Metadata = { title: "Connected sources" };

export default async function SourcesPage() {
  const ctx = await pageContext("/settings/sources", "sources.manage");
  if (!ctx.allowed) return <NoAccess what="connected sources" />;
  const { view, session } = ctx;
  return (
    <Screen n={43} brief={<Brief metrics={appsBrief(view)} live={presenceOf(view.members, session.user)} />}>
      <SourcesView sources={view.sources} syncProgress={view.syncProgress} />
    </Screen>
  );
}
