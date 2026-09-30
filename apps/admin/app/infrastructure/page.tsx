// Owner task: EB-100 Admin console shell — Cell & Cluster Infrastructure Health (screen 54): PostgreSQL pools, Qdrant nodes,
// the OpenSearch cluster and Temporal task queues per cell, each rolled up to ok / degraded / failing by the rules in
// lib/ops.ts. DEVELOPMENT values: real probes arrive with the control-plane API; the page says so.
import { Bento, BentoHead, Grid, Pill, formatNumber, formatPercent } from "@klarity/ui";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { OpScreen } from "@/components/OpScreen";
import { cellHealth, infrastructure, opensearchHealth, poolHealth, qdrantHealth, queueHealth, type Health } from "@/lib/ops";
import { getOperator } from "@/lib/session";

export const metadata: Metadata = { title: "Infrastructure" };

function State({ h }: { h: Health }) {
  return (
    <span className="eb-health" data-state={h}>
      <i aria-hidden="true" />
      {h}
    </span>
  );
}

export default async function InfrastructurePage() {
  if (!(await getOperator())) redirect("/login?next=/infrastructure");
  const cells = infrastructure();
  const all = cells.map((c) => cellHealth(c));
  const nodes = cells.flatMap((c) => c.qdrant);
  const queues = cells.flatMap((c) => c.temporal);
  const os = cells[0]!.opensearch;
  return (
    <OpScreen
      n={54}
      brief={[
        { label: "Cells", value: cells.length, note: `${all.filter((h) => h === "ok").length} healthy`, tone: all.every((h) => h === "ok") ? "green" : "cream" },
        { label: "Qdrant nodes up", value: `${nodes.filter((n) => n.up).length}/${nodes.length}`, note: `${formatNumber(nodes.reduce((a, n) => a + n.vectors, 0))} vectors`, tone: "sky" },
        { label: "OpenSearch", value: os.status, note: `${os.unassignedShards} unassigned shard${os.unassignedShards === 1 ? "" : "s"}`, tone: os.status === "green" ? "green" : "cream" },
        { label: "Temporal backlog", value: formatNumber(queues.reduce((a, q) => a + q.backlog, 0)), note: `${queues.reduce((a, q) => a + q.workers, 0)} workers`, tone: "lavender" },
      ]}
    >
      <div className="eb-stack">
        {cells.map((c) => (
          <Bento key={c.cellId} tone="strong" aria-label={`Cell ${c.cellId}`}>
            <BentoHead title={`Cell ${c.cellId} · ${c.region}`} aside={<State h={cellHealth(c)} />} />
            <Grid cols="1fr 1fr" align="start">
              <section aria-label="PostgreSQL pools">
                <h3 className="eb-h">PostgreSQL pools <span className="eb-dim">replica lag {c.replicaLagMs} ms</span></h3>
                <table className="eb-table">
                  <thead><tr><th>Pool</th><th className="r">Active</th><th className="r">Idle</th><th className="r">Waiting</th><th className="r">p95</th><th>State</th></tr></thead>
                  <tbody>
                    {c.pools.map((p) => (
                      <tr key={p.name}>
                        <td>{p.name}</td>
                        <td className="r">{p.active}/{p.max}</td>
                        <td className="r">{p.idle}</td>
                        <td className="r">{p.waiting}</td>
                        <td className="r">{p.p95Ms} ms</td>
                        <td><State h={poolHealth(p)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section aria-label="Qdrant">
                <h3 className="eb-h">Qdrant cluster <State h={qdrantHealth(c.qdrant)} /></h3>
                <table className="eb-table">
                  <thead><tr><th>Node</th><th className="r">Shards</th><th className="r">Vectors</th><th className="r">Disk</th><th>State</th></tr></thead>
                  <tbody>
                    {c.qdrant.map((n) => (
                      <tr key={n.id}>
                        <td className="eb-mono">{n.id}</td>
                        <td className="r">{n.shards}</td>
                        <td className="r">{formatNumber(n.vectors)}</td>
                        <td className="r">{formatPercent(n.diskPct, 0)}</td>
                        <td><State h={n.up ? (n.diskPct > 0.85 ? "degraded" : "ok") : "failing"} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section aria-label="OpenSearch">
                <h3 className="eb-h">OpenSearch cluster <State h={opensearchHealth(c.opensearch)} /></h3>
                <dl className="eb-kv">
                  <dt>Status</dt><dd><Pill size="sm" tone={c.opensearch.status === "green" ? "green" : c.opensearch.status === "yellow" ? "cream" : "pink"}>{c.opensearch.status}</Pill></dd>
                  <dt>Nodes</dt><dd>{c.opensearch.nodes}</dd>
                  <dt>Unassigned shards</dt><dd>{c.opensearch.unassignedShards}</dd>
                  <dt>JVM heap</dt><dd>{formatPercent(c.opensearch.heapPct, 0)}</dd>
                </dl>
                {c.opensearch.status === "yellow" ? <p className="eb-note">Yellow means replicas are unassigned: searches still work, but a node loss would lose redundancy.</p> : null}
              </section>
              <section aria-label="Temporal">
                <h3 className="eb-h">Temporal task queues</h3>
                <table className="eb-table">
                  <thead><tr><th>Queue</th><th className="r">Workers</th><th className="r">Backlog</th><th className="r">Start p95</th><th>State</th></tr></thead>
                  <tbody>
                    {c.temporal.map((q) => (
                      <tr key={q.name}>
                        <td className="eb-mono">{q.name}</td>
                        <td className="r">{q.workers}</td>
                        <td className="r">{q.backlog}</td>
                        <td className="r">{q.scheduleToStartP95Ms} ms</td>
                        <td><State h={queueHealth(q)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </Grid>
          </Bento>
        ))}
      </div>
    </OpScreen>
  );
}
