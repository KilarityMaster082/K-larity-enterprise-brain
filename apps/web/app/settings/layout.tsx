// Owner task: EB-93 Settings: connected sources and members — shared header and sub-navigation for screens 43–45.
import { Bento } from "@klarity/ui";
import type { ReactNode } from "react";

import { NoAccess } from "@/components/page/common";
import { pageContext } from "@/lib/page";

import { SettingsNav } from "./SettingsNav";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const ctx = await pageContext("/settings", "settings.view");
  if (!ctx.allowed) return <NoAccess what="workspace settings" />;
  const tabs = [
    { href: "/settings/sources", label: "Connected sources", show: ctx.can("sources.manage") },
    { href: "/settings/members", label: "Members & roles", show: ctx.can("members.manage") },
    { href: "/settings/security", label: "Retention & security", show: ctx.can("security.manage") },
    { href: "/apps", label: "Apps & tools", show: ctx.can("apps.manage") },
  ].filter((t) => t.show);
  return (
    <div className="eb-stack">
      <Bento tone="strong" pad="sm" aria-label="Settings">
        <SettingsNav tabs={tabs.map(({ href, label }) => ({ href, label }))} workspace={ctx.member.name} />
      </Bento>
      {children}
    </div>
  );
}
