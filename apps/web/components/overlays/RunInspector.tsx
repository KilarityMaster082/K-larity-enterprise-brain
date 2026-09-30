"use client";
// Owner task: EB-106 Agents and background jobs — Agent Run Inspector (screen 25): a terminal-style log of one run (plan,
// tool calls, results, errors, retries), with tokens, duration and retries. "Request a run" files an approval: agents
// never start work on their own authority (CLAUDE.md rule 10).
import { Bento, Icon, PillButton, Sheet, formatNumber, useToast } from "@klarity/ui";
import { useEffect, useState, useTransition } from "react";

import { requestApprovalAction } from "@/lib/data/actions";
import type { LogLine } from "@/lib/workspace";

interface Data {
  job: { jobId: string; name: string; schedule: string; status: string };
  run: { runId: string; startedAt: string; status: string; attempt: number };
  log: LogLine[];
  stats: { tokens: number; duration: string; retries: number; errors: number };
}

const COLOR: Record<LogLine["kind"], string> = { PLAN: "#c5effd", TOOL: "#d2ff1f", LLM: "#dcd3f8", RESULT: "#c6e4c1", ERROR: "#ffc9c9", RETRY: "#fff4d6", DONE: "#d2ff1f" };

export function RunInspector({ runId, onClose }: { runId: string | null; onClose: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const toast = useToast();

  useEffect(() => {
    if (!runId) return;
    setData(null);
    setError(null);
    const ctl = new AbortController();
    fetch(`/api/agents/runs/${encodeURIComponent(runId)}`, { signal: ctl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 403 ? "Your role cannot open agent runs." : "This run is not available.");
        return (await r.json()) as Data;
      })
      .then(setData)
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : "This run is not available.");
      });
    return () => ctl.abort();
  }, [runId]);

  return (
    <Sheet open={Boolean(runId)} onClose={onClose} wide labelledBy="run-title">
      {error ? (
        <p role="alert"><Icon name="lock" size={14} /> {error}</p>
      ) : !data ? (
        <p role="status" className="eb-dim">Loading the run…</p>
      ) : (
        <div className="eb-stack">
          <h2 id="run-title" className="eb-h-lg">{data.job.name} · run {data.run.runId.split("-").pop()} · {data.run.status}</h2>
          <div className="eb-terminal" role="log" aria-label="Run log">
            {data.log.map((l, i) => (
              <div key={i} className="eb-terminal-line">
                <span style={{ color: "#666" }}>{l.t}</span>
                <span style={{ color: COLOR[l.kind], width: 62, flex: "none" }}>{l.kind}</span>
                <span>{l.text}</span>
              </div>
            ))}
            {data.run.status === "running" ? <div style={{ color: "#d2ff1f", animation: "eb-blink 1s infinite" }}>▍</div> : null}
          </div>
          <div className="eb-grid" style={{ ["--cols" as string]: "1fr 1fr 1fr" }}>
            <Bento tone="lime"><h3 className="eb-h">Tokens consumed</h3><div className="eb-big-md eb-num">{formatNumber(data.stats.tokens)}</div></Bento>
            <Bento tone="sky"><h3 className="eb-h">Duration</h3><div className="eb-big-md eb-num">{data.stats.duration}</div></Bento>
            <Bento tone="cream"><h3 className="eb-h">Retries</h3><p className="eb-body">{data.stats.retries ? `${data.stats.retries} (attempt ${data.run.attempt}); ${data.stats.errors} error${data.stats.errors === 1 ? "" : "s"}` : "None"}</p></Bento>
          </div>
          <div>
            <PillButton
              tone="black"
              disabled={busy}
              onClick={() =>
                start(async () => {
                  const res = await requestApprovalAction({
                    kind: "create_task",
                    title: `Run “${data.job.name}” now`,
                    body: `Start an extra run of ${data.job.name} (normally ${data.job.schedule}).`,
                    reason: `Requested from the run inspector after run ${data.run.runId} ended ${data.run.status}.`,
                    evidenceIds: [],
                  });
                  toast(res.ok ? "Filed in Approvals. The run starts only when someone approves it." : res.error, res.ok ? "default" : "danger");
                })
              }
            >
              Request a run
            </PillButton>
          </div>
        </div>
      )}
    </Sheet>
  );
}
