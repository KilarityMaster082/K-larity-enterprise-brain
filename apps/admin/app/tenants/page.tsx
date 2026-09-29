// Owner task: EB-88 Tenant admin console — every tenant with tier, plan, status, connector health, usage and
// cost; provision new tenants without touching the database.
import { PageHeader } from "@klarity/ui";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { listTenants } from "@/lib/data";
import { getOperator } from "@/lib/session";

import { TenantsView, type TenantRow } from "./TenantsView";

export const metadata: Metadata = { title: "Tenants" };

export default async function TenantsPage() {
  if (!(await getOperator())) redirect("/login?next=/tenants");
  const rows: TenantRow[] = listTenants().map((t) => ({
    tenantId: t.tenantId,
    name: t.name,
    slug: t.slug,
    tier: t.tier,
    plan: t.plan,
    status: t.status,
    isSynthetic: t.isSynthetic,
    region: `${t.placement.region} · ${t.placement.cellId}`,
    sourcesOk: t.sources.filter((s) => s.health === "ok").length,
    sourcesTotal: t.sources.length,
    sourcesBad: t.sources.filter((s) => s.health === "auth_error" || s.health === "failing").length,
    questions: t.usage.questionsMonth,
    cost: t.usage.costMonthINR,
  }));
  return (
    <div className="content content-wide">
      <PageHeader title="Tenants" lead="Every customer workspace: where it lives, how healthy its sources are, and what it costs to serve." />
      <TenantsView rows={rows} />
    </div>
  );
}
