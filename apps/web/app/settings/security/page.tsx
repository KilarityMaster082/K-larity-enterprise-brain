// Owner task: EB-93 Settings: connected sources and members — Settings · Retention & Security (screen 45): the tenant
// retention policy (90 days to 7 years), the workspace's KMS key status and the audit log with CSV export. Owners only.
import type { Metadata } from "next";

import { NoAccess } from "@/components/page/common";
import { Brief, Screen, presenceOf } from "@/components/page/Screen";
import { appsBrief } from "@/lib/briefs";
import { RETENTION_CHOICES } from "@/lib/data/store";
import { pageContext } from "@/lib/page";

import { SecurityView } from "./SecurityView";

export const metadata: Metadata = { title: "Retention & security" };

export default async function SecurityPage() {
  const ctx = await pageContext("/settings/security", "security.manage");
  if (!ctx.allowed) return <NoAccess what="retention and security" />;
  const { view, session } = ctx;
  const r = view.data.workspace.retention;
  return (
    <Screen n={45} brief={<Brief metrics={appsBrief(view)} live={presenceOf(view.members, session.user)} />}>
      <SecurityView retention={r} choices={[...RETENTION_CHOICES]} audit={view.audit.slice(0, 100)} />
    </Screen>
  );
}
