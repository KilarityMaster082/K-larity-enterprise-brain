// Owner task: EB-29 Temporal ingestion pipeline — Dead-Letter Queue Inspector (screen 50): failed items from
// ingestion_dead_letter with stage, error, stack trace and attempt count, and a one-click replay that runs under the same
// idempotency key. Filters live in the URL (?tenant=&source=&stage=&state=). Every row carries its tenant.
import { Bento, BentoHead, Pill } from "@klarity/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { OpScreen } from "@/components/OpScreen";
import { listTenants } from "@/lib/data";
import { DLQ_STAGES, dlqByStage, doclingStats, listDeadLetters } from "@/lib/ops";
import { getOperator } from "@/lib/session";

import { DeadLetterList } from "./DeadLetterList";

export const metadata: Metadata = { title: "Dead-letter queue" };

type Sp = { tenant?: string; source?: string; stage?: string; state?: string };

export default async function DeadLetterPage({ searchParams }: { searchParams: Promise<Sp> }) {
  if (!(await getOperator())) redirect("/login?next=/dead-letter");
  const sp = await searchParams;
  const tenants = listTenants();
  const tenantId = tenants.some((t) => t.tenantId === sp.tenant) ? sp.tenant : undefined;
  const stage = (DLQ_STAGES as readonly string[]).includes(sp.stage ?? "") ? sp.stage : undefined;
  const state = sp.state === "resolved" || sp.state === "all" ? sp.state : "open";
  const source = sp.source && /^[\w.-]{1,64}$/.test(sp.source) ? sp.source : undefined;
  const rows = listDeadLetters({ tenantId, stage, sourceId: source, state });
  const open = listDeadLetters({ state: "open" });
  const name = new Map(tenants.map((t) => [t.tenantId, t.name]));
  const href = (patch: Partial<Sp>) => {
    const q = new URLSearchParams();
    const next = { tenant: tenantId, source, stage, state: state === "open" ? undefined : state, ...patch };
    for (const [k, v] of Object.entries(next)) if (v) q.set(k, v);
    return `/dead-letter${q.size ? `?${q}` : ""}`;
  };
  const docling = doclingStats();
  return (
    <OpScreen
      n={50}
      brief={[
        { label: "Open items", value: open.length, note: "waiting for a fix or a replay", tone: open.length ? "pink" : "green" },
        { label: "Parser (Docling)", value: docling.open, note: `${docling.timeouts} timeout${docling.timeouts === 1 ? "" : "s"}`, tone: "lavender" },
        { label: "Oldest", value: open.length ? `${Math.max(1, Math.round((Date.now() - new Date(open[open.length - 1]!.failedAt).getTime()) / 864e5))} d` : "—", note: "since first failure", tone: "cream" },
        { label: "Tenants affected", value: new Set(open.map((o) => o.tenantId)).size, note: `of ${tenants.length}`, tone: "sky" },
      ]}
    >
      <Bento tone="strong" aria-label="Dead letters">
        <BentoHead title="Failed items" aside={<Pill size="sm" tone="outline">{rows.length} shown</Pill>} />
        <nav className="eb-row" aria-label="Filters" style={{ gap: 6, flexWrap: "wrap", margin: "8px 0 12px" }}>
          {(["open", "resolved", "all"] as const).map((s) => (
            <Link key={s} href={href({ state: s === "open" ? undefined : s })} className="eb-pill" data-size="sm" data-active={s === state || undefined} aria-current={s === state ? "page" : undefined}>{s}</Link>
          ))}
          <span className="eb-dim" aria-hidden="true">|</span>
          <Link href={href({ stage: undefined })} className="eb-pill" data-size="sm" data-active={!stage || undefined}>all stages</Link>
          {dlqByStage(open).map((s) => (
            <Link key={s.stage} href={href({ stage: s.stage })} className="eb-pill" data-size="sm" data-active={stage === s.stage || undefined} aria-current={stage === s.stage ? "page" : undefined}>{s.stage} · {s.count}</Link>
          ))}
          {tenantId || source ? <Link href={href({ tenant: undefined, source: undefined })} className="eb-pill" data-size="sm" data-tone="outline">clear tenant/source filter ✕</Link> : null}
        </nav>
        <DeadLetterList
          rows={rows.map((d) => ({ id: d.id, tenant: name.get(d.tenantId) ?? d.tenantId, sourceId: d.sourceId, itemRef: d.itemRef, stage: d.stage, errorType: d.errorType, errorMessage: d.errorMessage, stack: d.stack, attemptCount: d.attemptCount, idempotencyKey: d.idempotencyKey, payloadRef: d.payloadRef, failedAt: d.failedAt, resolvedAt: d.resolvedAt, resolvedBy: d.resolvedBy, resolutionNotes: d.resolutionNotes }))}
        />
      </Bento>
    </OpScreen>
  );
}
