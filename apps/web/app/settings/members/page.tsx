// Owner task: EB-93 Settings: connected sources and members — Settings · Members & Roles (screen 44): the team directory
// with role assignments (Owner, Partner, Member, Viewer, Guest). Owners only. Role changes are audited and, in
// production, written to the workspace's OpenFGA store (packages/permissions).
import type { Metadata } from "next";

import { NoAccess } from "@/components/page/common";
import { Brief, Screen, presenceOf } from "@/components/page/Screen";
import { appsBrief } from "@/lib/briefs";
import { pageContext } from "@/lib/page";

import { MembersView } from "./MembersView";

export const metadata: Metadata = { title: "Members & roles" };

export default async function MembersPage() {
  const ctx = await pageContext("/settings/members", "members.manage");
  if (!ctx.allowed) return <NoAccess what="members and roles" />;
  const { view, session } = ctx;
  return (
    <Screen n={44} brief={<Brief metrics={appsBrief(view)} live={presenceOf(view.members, session.user)} />}>
      <MembersView members={view.members} currentUserId={session.user.id} fgaStore={`fga-${ctx.member.slug}`} />
    </Screen>
  );
}
