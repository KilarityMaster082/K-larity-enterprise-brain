// Owner task: EB-88 Tenant admin console — Audited Retrieval Test Console (screen 51): run a query "as" a kind of user and see
// the query plan (permission filter first), BM25 and fused scores, and the cross-encoder rerank latency against its SLA.
// Tenant content is shown only during an audited impersonation of that tenant; every query is recorded.
import { Bento, EmptyState } from "@klarity/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { OpScreen } from "@/components/OpScreen";
import { getTenant, SEARCH_AS } from "@/lib/data";
import { CHANNEL_WEIGHTS, RERANK_SLA_MS, RRF_K } from "@/lib/retrieval";
import { getOperator } from "@/lib/session";

import { RetrievalConsole } from "./RetrievalConsole";

export const metadata: Metadata = { title: "Retrieval console" };

export default async function RetrievalPage() {
  const s = await getOperator();
  if (!s) redirect("/login?next=/retrieval");
  const t = s.impersonating ? getTenant(s.impersonating.tenantId) : undefined;
  return (
    <OpScreen
      n={51}
      brief={[
        { label: "Tenant in view", value: t ? t.name : "none", note: t ? "audited, 30 minutes" : "start an audited view first", tone: t ? "lime" : "cream" },
        { label: "Fusion", value: `RRF k=${RRF_K}`, note: `bm25 ${CHANNEL_WEIGHTS.bm25} · dense ${CHANNEL_WEIGHTS.dense} · sparse ${CHANNEL_WEIGHTS.sparse}`, tone: "sky" },
        { label: "Rerank SLA", value: `< ${RERANK_SLA_MS} ms`, note: "p95, cross-encoder", tone: "lavender" },
        { label: "Permission filter", value: "before retrieval", note: "then again before rendering", tone: "green" },
      ]}
    >
      {t ? (
        <RetrievalConsole tenantName={t.name} searchAs={SEARCH_AS.map(({ id, label }) => ({ id, label }))} />
      ) : (
        <Bento tone="strong">
          <EmptyState
            icon="lock"
            title="Start an audited view of a tenant first"
            action={<Link className="eb-pill" data-tone="black" href="/tenants">Choose a tenant</Link>}
          >
            <p>Operators see tenant content only while viewing that tenant, with a reason, for 30 minutes. Every query is recorded.</p>
          </EmptyState>
        </Bento>
      )}
    </OpScreen>
  );
}
