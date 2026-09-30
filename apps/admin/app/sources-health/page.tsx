// Owner task: EB-39 Measure: ingestion freshness and error dashboard — Ingestion Pipeline & Worker Health (screen 49): every
// source of every tenant against its SLA (chat 5 min, files hourly), plus the connector detail an operator needs: Gmail
// historyId lag, the WhatsApp export queue and Docling parser failures. Temporal worker health is on screen 54.
import { Bento, BentoHead, Grid, Pill, formatNumber } from "@klarity/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { OpScreen } from "@/components/OpScreen";
import { doclingStats, pipelineRows } from "@/lib/ops";
import { getOperator } from "@/lib/session";

import { SourcesTable, type HealthRow } from "./SourcesTable";

export const metadata: Metadata = { title: "Sources health" };

export default async function SourcesHealth() {
  if (!(await getOperator())) redirect("/login?next=/sources-health");
  const rows = pipelineRows();
  const total = rows.length;
  const fresh = rows.filter((r) => r.slaMet).length;
  const errorOk = rows.filter((r) => r.errorRate < 0.02).length;
  const dead = rows.reduce((a, r) => a + r.deadLetters, 0);
  const gmail = rows.filter((r) => r.gmail);
  const wa = rows.filter((r) => r.whatsapp);
  const docling = doclingStats();
  const table: HealthRow[] = rows.map((r) => ({ ...r, tenant: r.tenantName }));
  return (
    <OpScreen
      n={49}
      brief={[
        { label: "Sources", value: total, note: "across all tenants", tone: "sky" },
        { label: "Within SLA", value: `${fresh}/${total}`, note: "chat 5 min · files 1 h", tone: fresh < total ? "pink" : "green" },
        { label: "Error rate under 2%", value: `${errorOk}/${total}`, note: "last 24 hours", tone: errorOk < total ? "pink" : "green" },
        { label: "Open dead letters", value: dead, note: "failed every retry", tone: dead ? "pink" : "lime" },
      ]}
    >
      <Grid cols="repeat(3, minmax(0, 1fr))" align="stretch">
        <Bento tone="sky" fill aria-label="Gmail history lag">
          <BentoHead title="Gmail · historyId lag" />
          {gmail.length === 0 ? <p className="eb-body">No Gmail sources.</p> : (
            <ul className="eb-list">
              {gmail.map((r) => (
                <li key={r.sourceId} className="eb-li" style={{ flexWrap: "wrap" }}>
                  <span className="eb-li-title eb-grow">{r.name}</span>
                  <Pill size="sm" tone={(r.historyLag ?? 0) > 100 ? "pink" : "green"}>{formatNumber(r.historyLag ?? 0)} behind</Pill>
                  <span className="eb-mono eb-dim" style={{ width: "100%" }}>head {r.gmail!.headHistoryId} · processed {r.gmail!.processedHistoryId}</span>
                </li>
              ))}
            </ul>
          )}
        </Bento>
        <Bento tone="green" fill aria-label="WhatsApp export queue">
          <BentoHead title="WhatsApp · export queue" />
          {wa.length === 0 ? <p className="eb-body">No WhatsApp sources.</p> : (
            <ul className="eb-list">
              {wa.map((r) => (
                <li key={r.sourceId} className="eb-li" style={{ flexWrap: "wrap" }}>
                  <span className="eb-li-title eb-grow">{r.name}</span>
                  <Pill size="sm" tone={r.whatsapp!.failed ? "pink" : "green"}>{r.whatsapp!.failed} failed</Pill>
                  <span className="eb-mono eb-dim" style={{ width: "100%" }}>{r.whatsapp!.queued} queued · {r.whatsapp!.parsing} parsing · {r.whatsapp!.parsed24h} parsed in 24 h · oldest waiting {r.whatsapp!.oldestQueuedMinutes} min</span>
                </li>
              ))}
            </ul>
          )}
        </Bento>
        <Bento tone="lavender" fill aria-label="Docling dead letters">
          <BentoHead title="Docling · dead-letter queue" aside={<Link href="/dead-letter?stage=parse" className="eb-pill" data-size="sm">Open queue</Link>} />
          <div className="eb-big">{docling.open}</div>
          <p className="eb-note">{docling.open ? `${docling.timeouts} timeout${docling.timeouts === 1 ? "" : "s"}, ${docling.open - docling.timeouts} table-structure failure${docling.open - docling.timeouts === 1 ? "" : "s"}` : "No parser failures waiting"}</p>
        </Bento>
        <Bento tone="strong" span={3} aria-label="Sources across tenants">
          <SourcesTable rows={table} />
        </Bento>
      </Grid>
    </OpScreen>
  );
}
