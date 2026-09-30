"use client";
// Owner task: EB-88 Tenant admin console — tenant table and the provision dialog.
import { Bento, DataTable, formatNumber, Icon, Modal, Money, Pill, PillButton, useToast, type Column } from "@klarity/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { provisionAction } from "@/lib/actions";
import { STATUS_PILL } from "@/lib/plans";

export interface TenantRow {
  tenantId: string;
  name: string;
  slug: string;
  tier: string;
  plan: string;
  status: string;
  isSynthetic: boolean;
  region: string;
  sourcesOk: number;
  sourcesTotal: number;
  sourcesBad: number;
  questions: number;
  cost: number;
}

export function TenantsView({ rows }: { rows: TenantRow[] }) {
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const cols: Column<TenantRow>[] = [
    {
      key: "name",
      header: "Tenant",
      cell: (r) => (
        <span className="stack-sm" style={{ gap: 0 }}>
          <Link className="cell-link" href={`/tenants/${r.tenantId}`}>
            {r.name}
          </Link>
          <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
            {r.slug}
            {r.isSynthetic ? " · synthetic" : ""}
          </span>
        </span>
      ),
      sort: (r) => r.name,
      text: (r) => `${r.name} ${r.slug} ${r.plan} ${r.status}`,
    },
    { key: "status", header: "Status", cell: (r) => <Pill size="sm" tone={STATUS_PILL[r.status] ?? "outline"}>{r.status}</Pill>, sort: (r) => r.status },
    { key: "tier", header: "Tier", cell: (r) => r.tier, sort: (r) => r.tier },
    { key: "plan", header: "Plan", cell: (r) => r.plan, sort: (r) => r.plan },
    { key: "region", header: "Region · cell", cell: (r) => r.region },
    {
      key: "sources",
      header: "Sources",
      cell: (r) =>
        r.sourcesTotal === 0 ? (
          <span className="muted">none</span>
        ) : (
          <span className="row">
            {r.sourcesOk}/{r.sourcesTotal} healthy
            {r.sourcesBad ? <Pill size="sm" tone="pink">{r.sourcesBad} failing</Pill> : null}
          </span>
        ),
      sort: (r) => r.sourcesBad,
    },
    { key: "q", header: "Questions (month)", numeric: true, cell: (r) => formatNumber(r.questions), sort: (r) => r.questions },
    { key: "cost", header: "Cost to serve (month)", numeric: true, cell: (r) => <Money amount={r.cost} exact />, sort: (r) => r.cost },
  ];
  return (
    <Bento tone="strong" aria-label="Tenants">
      <DataTable
        rows={rows}
        columns={cols}
        rowKey={(r) => r.tenantId}
        caption="Tenants"
        searchPlaceholder="Filter tenants"
        toolbar={
          <span style={{ marginLeft: "auto" }}>
            <PillButton tone="black" onClick={() => setOpen(true)}>
              <Icon name="plus" size={14} /> Provision tenant
            </PillButton>
          </span>
        }
      />
      <Modal open={open} onClose={() => setOpen(false)} title="Provision a tenant">
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            start(async () => {
              const r = await provisionAction({ name: String(f.get("name")), slug: String(f.get("slug")), tier: String(f.get("tier")), plan: String(f.get("plan")) });
              if (r.ok) {
                setOpen(false);
                toast("Provisioning started.");
                router.push(`/tenants/${r.message}`);
              } else toast(r.error, "danger");
            });
          }}
        >
          <label className="field">
            Organisation name
            <input name="name" className="input" required maxLength={120} />
          </label>
          <label className="field">
            Slug <span className="field-hint">lowercase, used in URLs and the Keycloak organization alias</span>
            <input name="slug" className="input" required pattern="[a-z0-9][a-z0-9\-]{1,62}" maxLength={63} />
          </label>
          <div className="grid-2">
            <label className="field">
              Tier
              <select name="tier" className="select" defaultValue="pool">
                <option value="pool">Pool (shared)</option>
                <option value="bridge">Bridge (dedicated shard/index/queue)</option>
              </select>
            </label>
            <label className="field">
              Plan
              <select name="plan" className="select" defaultValue="starter">
                <option value="pilot">Pilot</option>
                <option value="starter">Starter</option>
                <option value="business">Business</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </label>
          </div>
          <p className="note note-info">Region: India (ap-south-2), cell pool-in-1. Silo tenants need a dedicated cell and are provisioned by the platform team.</p>
          <div className="row">
            <button type="submit" className="eb-pill" data-tone="black" disabled={busy}>
              Provision
            </button>
          </div>
        </form>
      </Modal>
    </Bento>
  );
}
