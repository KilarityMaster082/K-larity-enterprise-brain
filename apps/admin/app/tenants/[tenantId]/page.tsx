// Owner task: EB-88 Tenant admin console — one tenant: placement, provisioning progress, usage and cost,
// source health, and the audited operator controls (suspend/resume, plan, impersonation).
import { Badge, Card, formatDateTime, formatNumber, Icon, KpiTile, Money, PageHeader } from "@klarity/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getTenant, PROVISION_STEPS, provisioningStep } from "@/lib/data";
import { getOperator } from "@/lib/session";

import { STATUS_TONE } from "@/lib/plans";
import { ProvisionWatcher, TenantControls } from "./TenantControls";

export const metadata: Metadata = { title: "Tenant" };

export default async function TenantPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const s = await getOperator();
  if (!s) redirect(`/login?next=/tenants/${tenantId}`);
  const t = getTenant(tenantId);
  if (!t) notFound();
  const step = provisioningStep(t);
  const p = t.placement;
  const placement: [string, string][] = [
    ["Tenant id", t.tenantId],
    ["Cell · region", `${p.cellId} · ${p.region}`],
    ["Postgres database", p.pgDatabase],
    ["Object prefix", p.objectPrefix],
    ["Qdrant shard key", p.qdrantShardKey],
    ["OpenSearch index → alias", `${p.opensearchIndex} → ${p.opensearchAlias}`],
    ["Temporal queues", `${p.temporalQueuePrefix}.*`],
    ["LiteLLM team", p.litellmTeam],
    ["KMS key", p.kmsKeyRef],
    ["Keycloak organization", p.keycloakOrgId ?? "— (created during provisioning)"],
  ];
  return (
    <div className="content content-wide">
      <PageHeader
        crumbs={
          <>
            <Link href="/tenants">Tenants</Link> <span aria-hidden="true">/</span> <span>{t.slug}</span>
          </>
        }
        title={t.name}
        lead={`${t.tier} tier · ${t.plan} plan · created ${formatDateTime(t.createdAt)}`}
        actions={
          <span className="row">
            {t.isSynthetic ? <Badge tone="warn">Synthetic test tenant</Badge> : null}
            <Badge tone={STATUS_TONE[t.status] ?? "neutral"}>{t.status}</Badge>
          </span>
        }
      />
      <div className="stack-lg">
        {t.status === "provisioning" ? (
          <Card title="Provisioning (ProvisionTenant workflow)">
            <ProvisionWatcher />
            <ol className="steps-list">
              {PROVISION_STEPS.map((name, i) => (
                <li key={name} data-state={i < step ? "done" : i === step ? "running" : "todo"}>
                  <Icon name={i < step ? "checkCircle" : i === step ? "refresh" : "clock"} size={16} />
                  {name}
                  {i === step ? <span className="visually-hidden"> (running)</span> : null}
                </li>
              ))}
            </ol>
          </Card>
        ) : null}

        <div className="kpis">
          <KpiTile label="Questions this month" value={formatNumber(t.usage.questionsMonth)} />
          <KpiTile label="LLM tokens this month" value={formatNumber(t.usage.llmTokensMonth)} />
          <KpiTile label="Storage" value={`${t.usage.storageGb} GB`} foot={`${formatNumber(t.usage.vectors)} vectors`} />
          <KpiTile label="Cost to serve (month)" value={<Money amount={t.usage.costMonthINR} exact />} accent />
        </div>

        <div className="grid-main-side">
          <Card title="Placement (from the tenant registry)">
            <dl className="kv">
              {placement.map(([k, v]) => (
                <span key={k} style={{ display: "contents" }}>
                  <dt>{k}</dt>
                  <dd>
                    <code>{v}</code>
                  </dd>
                </span>
              ))}
            </dl>
          </Card>
          <Card title="Operator actions">
            <TenantControls tenantId={t.tenantId} name={t.name} status={t.status} plan={t.plan} impersonatingThis={s.impersonating?.tenantId === t.tenantId} />
          </Card>
        </div>

        <Card title="Sources" actions={<Link href="/sources-health">All sources health</Link>}>
          {t.sources.length ? (
            <ul className="list-plain stack-sm">
              {t.sources.map((src) => (
                <li key={src.sourceId} className="row-between">
                  <span>
                    <strong>{src.name}</strong> <span className="muted">({src.type})</span>
                  </span>
                  <Badge tone={src.health === "ok" ? "ok" : src.health === "degraded" ? "warn" : "danger"}>{src.health}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No sources connected yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
