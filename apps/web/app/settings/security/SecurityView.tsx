"use client";
// Owner task: EB-93 Settings: connected sources and members — retention form, key status, audit table and export.
import { Bento, BentoHead, DataTable, Pill, PillButton, PillLink, formatDateTime, useToast, type Column } from "@klarity/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setRetentionAction } from "@/lib/data/actions";
import type { AuditEvent, RetentionPolicy } from "@/lib/data/types";

function label(days: number): string {
  if (days < 365) return `${days} days`;
  const y = days / 365;
  return `${Number.isInteger(y) ? y : y.toFixed(1)} ${y === 1 ? "year" : "years"}`;
}

export function SecurityView({ retention, choices, audit }: { retention: RetentionPolicy; choices: number[]; audit: AuditEvent[] }) {
  const [days, setDays] = useState(retention.days);
  const [busy, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  const cols: Column<AuditEvent>[] = [
    { key: "at", header: "When (IST)", cell: (a) => formatDateTime(a.at), sort: (a) => a.at },
    { key: "actor", header: "Who", cell: (a) => a.actor, sort: (a) => a.actor, text: (a) => `${a.actor} ${a.action} ${a.target} ${a.detail ?? ""}` },
    { key: "action", header: "Action", cell: (a) => <code>{a.action}</code>, sort: (a) => a.action },
    { key: "target", header: "On", cell: (a) => a.target },
    { key: "detail", header: "Detail", cell: (a) => a.detail ?? "" },
  ];

  return (
    <div className="eb-stack">
      <div className="eb-grid" style={{ ["--cols" as string]: "1.2fr 1fr 1fr", alignItems: "stretch" }}>
        <Bento tone="lime" fill aria-label="Retention policy">
          <BentoHead title="Retention policy" />
          <form
            className="eb-stack tight"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const res = await setRetentionAction(days);
                if (res.ok) {
                  toast(res.message ?? "Saved.");
                  router.refresh();
                } else toast(res.error, "danger");
              });
            }}
          >
            <label className="eb-label">
              Keep indexed content for
              <select className="eb-input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {choices.map((d) => (
                  <option key={d} value={d}>
                    {label(d)}
                  </option>
                ))}
              </select>
            </label>
            <div className="eb-row">
              <PillButton type="submit" tone="black" disabled={busy || days === retention.days}>Save policy</PillButton>
              <span className="eb-note">Currently {label(retention.days)}. Changes are audited.</span>
            </div>
          </form>
        </Bento>
        <Bento tone="black" fill aria-label="Encryption key">
          <BentoHead title="KMS encryption key" />
          <div className="eb-big-md eb-lime-text" style={{ textTransform: "capitalize" }}>{retention.kmsKeyState}</div>
          <p className="eb-note">
            <span className="eb-mono">{retention.kmsKeyAlias || "no key yet"}</span>
            <br />
            Last rotated {formatDateTime(retention.lastRotatedAt)} IST
          </p>
        </Bento>
        <Bento tone="sky" fill aria-label="Audit log export">
          <BentoHead title="Audit log export" />
          <p className="eb-body">{retention.auditExportAt ? `Last exported ${formatDateTime(retention.auditExportAt)} IST.` : "Never exported."}</p>
          <div>
            <PillLink tone="black" href="/api/audit/export" download>
              Download CSV
            </PillLink>
          </div>
          <Pill tone="outline" size="sm">Each export is itself audited</Pill>
        </Bento>
      </div>
      <Bento tone="strong" aria-label="Audit log">
        <BentoHead title="Audit log" eyebrow />
        <div style={{ marginTop: 8 }}>
          <DataTable rows={audit} columns={cols} rowKey={(a) => a.id} caption="Audit log" initialSort={{ key: "at", dir: "desc" }} searchPlaceholder="Filter the audit log" empty="No audited actions yet." />
        </div>
      </Bento>
    </div>
  );
}
