// Owner task: EB-26 LiteLLM gateway — LLM Gateway & Budget Metering (screen 52): spend per tenant against the monthly cap
// (USD 500 by default, alert at 85 %, blocked at the cap), the split across the fast / reason / embed / rerank aliases with
// latency and fallback counts, and recent traces. Trace links appear only when the deployment sets LANGFUSE_BASE_URL.
import { Bento, BentoHead, Grid, Pill, formatNumber } from "@klarity/ui";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { OpScreen } from "@/components/OpScreen";
import { ALERT_THRESHOLD, ALIASES, DEFAULT_BUDGET_USD, gatewayRows, traceUrl } from "@/lib/ops";
import { getOperator } from "@/lib/session";

import { BudgetForm } from "./BudgetForm";

export const metadata: Metadata = { title: "LLM gateway" };

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n < 10 ? 2 : 0, maximumFractionDigits: 2 })}`;
const STATE = { ok: { tone: "green", label: "Within budget" }, alert: { tone: "cream", label: "Over 85 %" }, blocked: { tone: "pink", label: "Blocked at cap" } } as const;

export default async function GatewayPage() {
  if (!(await getOperator())) redirect("/login?next=/gateway");
  const rows = gatewayRows();
  const spend = rows.reduce((a, r) => a + r.spendUsd, 0);
  const cap = rows.reduce((a, r) => a + r.capUsd, 0);
  const fallbacks = rows.flatMap((r) => r.byAlias).reduce((a, x) => a + x.fallbackCalls, 0);
  const calls = rows.flatMap((r) => r.byAlias).reduce((a, x) => a + x.calls, 0);
  const worst = [...rows].sort((a, b) => b.pct - a.pct)[0];
  return (
    <OpScreen
      n={52}
      brief={[
        { label: "Spend this month", value: usd(spend), note: `of ${usd(cap)} in caps`, tone: "lime" },
        { label: "Highest tenant", value: worst ? `${Math.round(worst.pct * 100)}%` : "—", note: worst?.tenantName ?? "", tone: worst && worst.state !== "ok" ? "pink" : "sky" },
        { label: "Gateway calls", value: formatNumber(calls), note: `${formatNumber(fallbacks)} served by a fallback`, tone: "lavender" },
        { label: "Default cap", value: usd(DEFAULT_BUDGET_USD), note: `alert at ${Math.round(ALERT_THRESHOLD * 100)} %`, tone: "cream" },
      ]}
    >
      <div className="eb-stack">
        {rows.map((r) => {
          const st = STATE[r.state];
          return (
            <Bento key={r.tenantId} tone="strong" aria-label={r.tenantName}>
              <BentoHead title={r.tenantName} aside={<><Pill size="sm" tone={st.tone}>{st.label}</Pill>{r.isSynthetic ? <Pill size="sm" tone="cream">Synthetic</Pill> : null}</>} />
              <div className="eb-row" style={{ gap: 12, margin: "8px 0" }}>
                <div className="eb-grow">
                  <div className="eb-meter" data-state={r.state} role="meter" aria-valuemin={0} aria-valuemax={r.capUsd} aria-valuenow={r.spendUsd} aria-label={`${usd(r.spendUsd)} of ${usd(r.capUsd)}`}>
                    <i style={{ width: `${Math.min(100, r.pct * 100)}%` }} />
                    <b style={{ left: `${ALERT_THRESHOLD * 100}%` }} title="Alert threshold" />
                  </div>
                </div>
                <b className="eb-mono">{usd(r.spendUsd)} / {usd(r.capUsd)}</b>
              </div>
              <Grid cols="1fr 1fr" align="start">
                <table className="eb-table" aria-label={`${r.tenantName} spend by alias`}>
                  <thead><tr><th>Alias</th><th className="r">Calls</th><th className="r">Spend</th><th className="r">p50</th><th className="r">p95</th><th className="r">Fallbacks</th></tr></thead>
                  <tbody>
                    {ALIASES.map((a) => {
                      const u = r.byAlias.find((x) => x.alias === a)!;
                      return (
                        <tr key={a}>
                          <td><code className="eb-mono">{a}</code></td>
                          <td className="r">{formatNumber(u.calls)}</td>
                          <td className="r">{usd(u.costUsd)}</td>
                          <td className="r">{u.p50Ms} ms</td>
                          <td className="r">{u.p95Ms} ms</td>
                          <td className="r">{u.fallbackCalls}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div>
                  <h3 className="eb-h">Recent traces</h3>
                  {r.traces.length === 0 ? <p className="eb-note">No calls yet this month.</p> : (
                    <ul className="eb-list">
                      {r.traces.map((t) => {
                        const url = traceUrl(t.traceId);
                        return (
                          <li key={t.traceId} className="eb-li">
                            <code className="eb-mono" style={{ width: 82 }}>{url ? <a href={url} target="_blank" rel="noreferrer noopener">{t.traceId}</a> : t.traceId}</code>
                            <span className="eb-grow eb-trunc">{t.purpose}</span>
                            <Pill size="sm" tone="outline">{t.alias}{t.fellBackTo ? ` → ${t.fellBackTo}` : ""}</Pill>
                            <span className="eb-mono eb-dim">{t.latencyMs} ms</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </Grid>
              <BudgetForm tenantId={r.tenantId} tenant={r.tenantName} cap={r.capUsd} />
            </Bento>
          );
        })}
      </div>
    </OpScreen>
  );
}
