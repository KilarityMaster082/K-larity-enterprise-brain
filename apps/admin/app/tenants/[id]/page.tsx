// Owner task: EB-88 Tenant admin console — Tenant Detail & Placement Inspector (screen 48): one tenant's placement (S3 prefix,
// KMS alias, OpenSearch alias, Qdrant shard key, Temporal queues, LiteLLM team, Keycloak organisation), provisioning progress,
// usage and cost, source health, and the audited operator controls (suspend/resume, plan, impersonation gate).
import { Bento, BentoHead, Grid, Icon, Pill, formatDateTime, formatNumber } from "@klarity/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { OpScreen } from "@/components/OpScreen";
import { getTenant, PROVISION_STEPS, provisioningStep } from "@/lib/data";
import { openDeadLetters } from "@/lib/ops";
import { STATUS_PILL } from "@/lib/plans";
import { getOperator } from "@/lib/session";

import { ProvisionWatcher, TenantControls } from "./TenantControls";

export const metadata: Metadata = { title: "Tenant" };

export default async function TenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getOperator();
  if (!s) redirect(`/login?next=/tenants/${id}`);
  const t = getTenant(id);
  if (!t) notFound();
  const step = provisioningStep(t);
  const p = t.placement;
  const placement: [string, string][] = [
    ["Tenant id", t.tenantId],
    ["Cell · region", `${p.cellId} · ${p.region}`],
    ["Postgres database", p.pgDatabase],
    ["S3 prefix", p.objectPrefix],
    ["KMS alias", p.kmsKeyRef],
    ["OpenSearch index → alias", `${p.opensearchIndex} → ${p.opensearchAlias}`],
    ["Qdrant shard key", p.qdrantShardKey],
    ["OpenFGA store", `store-${t.slug}`],
    ["Temporal queues", `${p.temporalQueuePrefix}.*`],
    ["LiteLLM team", p.litellmTeam],
    ["Keycloak organization", p.keycloakOrgId ?? "— (created during provisioning)"],
  ];
  const dead = openDeadLetters(t.tenantId);
  return (
    <OpScreen
      n={48}
      brief={[
        { label: t.name, value: t.status, note: `${t.tier} tier · ${t.plan} plan`, tone: "lime" },
        { label: "Questions this month", value: formatNumber(t.usage.questionsMonth), note: `${formatNumber(t.usage.llmTokensMonth)} LLM tokens`, tone: "sky" },
        { label: "Storage", value: `${t.usage.storageGb} GB`, note: `${formatNumber(t.usage.vectors)} vectors`, tone: "lavender" },
        { label: "Open dead letters", value: dead, note: dead ? "see the queue" : "none", tone: "pink" },
      ]}
    >
      <div className="eb-stack">
        <p className="eb-note">
          <Link href="/tenants">Tenants</Link> / {t.slug} · created {formatDateTime(t.createdAt)} {t.isSynthetic ? <Pill size="sm" tone="cream">Synthetic test tenant</Pill> : null} <Pill size="sm" tone={STATUS_PILL[t.status] ?? "outline"}>{t.status}</Pill>
        </p>
        {t.status === "provisioning" ? (
          <Bento tone="sky" aria-label="Provisioning">
            <BentoHead title="Provisioning (ProvisionTenant workflow)" />
            <ProvisionWatcher />
            <ol className="steps-list">
              {PROVISION_STEPS.map((name, i) => (
                <li key={name} data-state={i < step ? "done" : i === step ? "running" : "todo"}>
                  <Icon name={i < step ? "checkCircle" : i === step ? "refresh" : "clock"} size={14} />
                  {name}
                  {i === step ? <span className="visually-hidden"> (running)</span> : null}
                </li>
              ))}
            </ol>
          </Bento>
        ) : null}
        <Grid cols="1fr 330px" align="start">
          <Bento tone="strong" aria-label="Placement">
            <BentoHead title="Placement (from the tenant registry)" />
            <dl className="eb-kv">
              {placement.map(([k, v]) => (
                <span key={k} style={{ display: "contents" }}>
                  <dt>{k}</dt>
                  <dd className="eb-mono" style={{ wordBreak: "break-all" }}>{v}</dd>
                </span>
              ))}
            </dl>
          </Bento>
          <Bento tone="lime" aria-label="Operator actions">
            <BentoHead title="Operator actions" />
            <TenantControls tenantId={t.tenantId} name={t.name} status={t.status} plan={t.plan} impersonatingThis={s.impersonating?.tenantId === t.tenantId} />
          </Bento>
        </Grid>
        <Bento tone="strong" aria-label="Sources">
          <BentoHead title="Sources" aside={<Link href="/sources-health" className="eb-pill" data-size="sm">Pipeline health</Link>} />
          {t.sources.length ? (
            <ul className="eb-list">
              {t.sources.map((src) => (
                <li key={src.sourceId} className="eb-li">
                  <span className="eb-li-title eb-grow">{src.name} <span className="eb-dim">({src.type})</span></span>
                  <Pill size="sm" tone={src.health === "ok" ? "green" : src.health === "degraded" ? "cream" : "pink"}>{src.health}</Pill>
                </li>
              ))}
            </ul>
          ) : (
            <p className="eb-body">No sources connected yet.</p>
          )}
        </Bento>
      </div>
    </OpScreen>
  );
}
