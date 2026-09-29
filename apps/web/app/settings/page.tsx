// Owner task: EB-93 Settings: connected sources and members — the owner's control room for what the Brain
// can read and who can use it. Shows source health from the registry; never renders or logs a credential.
import { PageHeader } from "@klarity/ui";
import type { Metadata } from "next";

import { NoAccess } from "@/components/page/common";
import { pageContext } from "@/lib/page";

import { SettingsView } from "./SettingsView";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await pageContext("/settings", "settings.view");
  if (!ctx.allowed) return <NoAccess what="workspace settings" />;
  const { tab } = await searchParams;
  return (
    <div className="content content-wide">
      <PageHeader title="Settings" lead={`Sources, members and audit for ${ctx.member.name}.`} />
      <SettingsView
        initialTab={tab === "members" || tab === "audit" || tab === "data" ? tab : "sources"}
        sources={ctx.view.sources}
        members={ctx.view.members}
        audit={ctx.view.audit.slice(0, 100)}
        syncProgress={ctx.view.syncProgress}
        canManageSources={ctx.can("sources.manage")}
        canManageMembers={ctx.can("members.manage")}
        currentUserId={ctx.session.user.id}
      />
    </div>
  );
}
