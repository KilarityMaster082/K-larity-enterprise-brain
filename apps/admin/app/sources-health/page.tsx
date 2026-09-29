// Owner task: EB-39 Measure: ingestion freshness and error dashboard — every source of every tenant: last sync,
// lag, items per day, error rate and dead letters, against the targets (lag ≤ 5 min for mail/WhatsApp, errors < 2%).
import { KpiTile, PageHeader } from "@klarity/ui";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { listTenants, type SourceHealthRow } from "@/lib/data";
import { getOperator } from "@/lib/session";

import { SourcesTable, type HealthRow } from "./SourcesTable";

export const metadata: Metadata = { title: "Sources health" };

export default async function SourcesHealth() {
  if (!(await getOperator())) redirect("/login?next=/sources-health");
  const rows: HealthRow[] = listTenants().flatMap((t) => t.sources.map((s: SourceHealthRow) => ({ ...s, tenant: t.name, tenantId: t.tenantId })));
  const total = rows.length;
  const lagTarget = (r: HealthRow) => (r.type === "gmail" || r.type === "whatsapp" ? 5 : 60);
  const fresh = rows.filter((r) => r.lagMinutes <= lagTarget(r)).length;
  const errorOk = rows.filter((r) => r.errorRate < 0.02).length;
  const dead = rows.reduce((a, r) => a + r.deadLetters, 0);
  return (
    <div className="content content-wide">
      <PageHeader title="Sources health" lead="Freshness and errors for every connected source. Targets: mail and WhatsApp within 5 minutes, others within an hour; errors under 2%." />
      <div className="stack-lg">
        <div className="kpis">
          <KpiTile label="Sources" value={total} />
          <KpiTile label="Within freshness target" value={`${fresh}/${total}`} tone={fresh < total ? "danger" : undefined} />
          <KpiTile label="Error rate under 2%" value={`${errorOk}/${total}`} tone={errorOk < total ? "danger" : undefined} />
          <KpiTile label="Dead letters" value={dead} tone={dead ? "danger" : undefined} foot="Items that failed every retry" />
        </div>
        <SourcesTable rows={rows} />
      </div>
    </div>
  );
}

