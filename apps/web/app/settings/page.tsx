// Owner task: EB-23 Web UI shell
// Status: designed placeholder (EB-23 shell) — data arrives with the owning task.
import type { Metadata } from "next";

import { NoAccess, PagePlaceholder } from "@/components/ui/PagePlaceholder";
import { requirePage } from "@/lib/guard";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { allowed } = await requirePage("/settings");
  if (!allowed) return <NoAccess what="workspace settings" />;
  return (
    <PagePlaceholder
      title="Settings"
      lead="Workspace sources, members and roles."
      icon="settings"
      emptyTitle="Settings are coming soon"
      emptyBody="Workspace owners will connect sources and manage members here."
      willShow={[
        "Connected sources and their sync health",
        "Members, roles and invitations",
        "Data retention and export"
      ]}
    />
  );
}
