// Owner task: EB-88 Tenant admin console — Tenant Registry Fleet Overview (screen 47): every tenant with tier, plan, status,
// connector health, usage and cost; provision new tenants without touching the database.
import { formatINRShort, formatNumber } from "@klarity/ui";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { OpScreen } from "@/components/OpScreen";
import { listTenants } from "@/lib/data";
import { getOperator } from "@/lib/session";

import { TenantsView, type TenantRow } from "./TenantsView";

export const metadata: Metadata = { title: "Tenants" };

export default async function TenantsPage() {
  if (!(await getOperator())) redirect("/login?next=/tenants");
  const tenants = listTenants();
  const rows: TenantRow[] = tenants.map((t) => ({
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
  const real = tenants.filter((t) => !t.isSynthetic);
  const bad = rows.reduce((a, r) => a + r.sourcesBad, 0);
  return (
    <OpScreen
      n={47}
      brief={[
        { label: "Customer tenants", value: real.length, note: `${tenants.length - real.length} synthetic`, tone: "lime" },
        { label: "Questions this month", value: formatNumber(tenants.reduce((a, t) => a + t.usage.questionsMonth, 0)), note: "all tenants", tone: "sky" },
        { label: "Cost to serve", value: formatINRShort(tenants.reduce((a, t) => a + t.usage.costMonthINR, 0)), note: "this month", tone: "lavender" },
        { label: "Sources needing attention", value: bad, note: bad ? "re-authorise or fix" : "all healthy", tone: "pink" },
      ]}
    >
      <TenantsView rows={rows} />
    </OpScreen>
  );
}
