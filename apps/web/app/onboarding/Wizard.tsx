"use client";
// Owner task: EB-94 First-run onboarding and empty-state journeys — the wizard body. Four steps on a stepper line;
// connecting a source starts its (simulated, in development) first sync; "Test connection" is a read-only probe.
import { Bento, Grid, Icon, PillButton, PillLink, ProgressTrack, formatNumber, useToast } from "@klarity/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { connectSourceAction, testConnectionAction } from "@/lib/data/actions";
import type { Source, SourceHealth } from "@/lib/data/types";

interface Row {
  sourceId: string;
  type: Source["connectorType"];
  name: string;
  account: string;
  health: SourceHealth;
  itemsSeen: number;
  lastError?: string;
}

const STEPS = ["Welcome", "Connect sources", "Test & sync", "First questions"];
const CONNECTORS: { type: Source["connectorType"]; label: string; hint: string }[] = [
  { type: "drive", label: "Google Drive", hint: "Shared drive or folder name" },
  { type: "gmail", label: "Gmail", hint: "Mailbox, e.g. partners@yourfirm.com" },
  { type: "whatsapp", label: "WhatsApp", hint: "Group name of the export" },
  { type: "sheets", label: "Google Sheets", hint: "Workbook name" },
  { type: "calendar", label: "Google Calendar", hint: "Calendar account" },
];
const TONES = ["green", "pink", "cream", "sky", "lavender"] as const;

export function Wizard({ step, workspace, sources, syncProgress, itemsIndexed, questions }: { step: number; workspace: string; sources: Row[]; syncProgress?: number; itemsIndexed: number; questions: string[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [account, setAccount] = useState<Record<string, string>>({});
  const go = (n: number) => router.push(`/onboarding?step=${n}`);

  useEffect(() => {
    if (syncProgress === undefined) return;
    const t = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(t);
  }, [syncProgress, router]);

  const connect = (type: Source["connectorType"]) =>
    start(async () => {
      const res = await connectSourceAction(type, account[type] ?? "");
      if (res.ok) {
        toast(res.message ?? "Connected.");
        router.refresh();
      } else toast(res.error, "danger");
    });
  const test = (id: string) =>
    start(async () => {
      const res = await testConnectionAction(id);
      toast(res.ok ? (res.message ?? "Reachable.") : res.error, res.ok ? "default" : "danger");
    });

  const synced = sources.some((s) => s.health !== "syncing" && s.health !== "never_run");
  const pct = (s: Row) => (s.health === "syncing" ? Math.round((syncProgress ?? 0) * 100) : s.health === "never_run" ? 0 : 100);

  return (
    <div className="eb-stack">
      <Bento tone="sky" aria-label="First-run setup progress">
        <h2 className="eb-eyebrow">First-run setup</h2>
        <ol className="eb-steps" aria-label="Steps">
          {STEPS.map((t, i) => (
            <li key={t} aria-current={i === step ? "step" : undefined} data-done={i < step || undefined}>
              <button type="button" onClick={() => go(i)} className="eb-step-btn">
                <span className="eb-step-dot" style={{ background: i <= step ? "var(--eb-lime)" : "#fff" }} aria-hidden="true" />
                {t}
              </button>
            </li>
          ))}
        </ol>
      </Bento>

      {step === 0 ? (
        <Grid cols="1.2fr 1fr" align="stretch">
          <Bento tone="hero" pad="lg" className="eb-stack">
            <h1 className="eb-hero-title">Welcome to {workspace}’s Brain.</h1>
            <p className="eb-body">It reads your email, drawings, ledger and chat, then answers with the source for every claim. It only searches what each person's role can open, and nothing is sent without an approval.</p>
            <div><PillButton tone="black" size="lg" onClick={() => go(1)}>Connect your first source →</PillButton></div>
          </Bento>
          <Bento tone="lime" fill>
            <h2 className="eb-h">Takes about ten minutes</h2>
            <p className="eb-body">Connect, test, wait for the first sync, then ask. You can leave and come back; the sync keeps running.</p>
          </Bento>
        </Grid>
      ) : null}

      {step === 1 ? (
        <Grid cols="repeat(3, 1fr)">
          {CONNECTORS.map((c, i) => {
            const have = sources.filter((s) => s.type === c.type);
            return (
              <Bento key={c.type} tone={have.length ? TONES[i % TONES.length]! : "glass"} fill style={{ minHeight: 130 }}>
                <div className="eb-row" style={{ justifyContent: "space-between" }}>
                  <h2 className="eb-h-lg">{c.label}</h2>
                  {have.length ? <Icon name="check" size={14} /> : null}
                </div>
                {have.length ? (
                  <p className="eb-note">{have.map((h) => h.account).join(", ")} connected</p>
                ) : (
                  <form
                    className="eb-row nowrap"
                    onSubmit={(e) => {
                      e.preventDefault();
                      connect(c.type);
                    }}
                  >
                    <label className="visually-hidden" htmlFor={`acct-${c.type}`}>
                      {c.label}: {c.hint}
                    </label>
                    <input id={`acct-${c.type}`} className="eb-input" placeholder={c.hint} required value={account[c.type] ?? ""} onChange={(e) => setAccount({ ...account, [c.type]: e.target.value })} />
                    <PillButton type="submit" tone="black" disabled={busy}>Connect</PillButton>
                  </form>
                )}
              </Bento>
            );
          })}
        </Grid>
      ) : null}

      {step === 2 ? (
        <Grid cols="repeat(3, 1fr)">
          {sources.length === 0 ? (
            <Bento tone="cream" span={3}>
              <p className="eb-body">Nothing to test yet. <PillButton tone="black" size="sm" onClick={() => go(1)}>Connect a source</PillButton></p>
            </Bento>
          ) : null}
          {sources.map((s, i) => (
            <Bento key={s.sourceId} tone={s.health === "auth_error" || s.health === "failing" ? "pink" : TONES[i % TONES.length]!} fill style={{ minHeight: 130 }}>
              <div className="eb-row" style={{ justifyContent: "space-between" }}>
                <h2 className="eb-h-lg">{s.name}</h2>
                {s.health === "syncing" ? <span className="eb-dot eb-dot-ink eb-dot-lg" role="img" aria-label="Syncing" /> : null}
              </div>
              <p className="eb-note">
                {s.health === "syncing" ? `First sync ${pct(s)}%` : s.health === "auth_error" ? (s.lastError ?? "Needs reconnect") : `${formatNumber(s.itemsSeen)} items indexed`}
              </p>
              <ProgressTrack pct={pct(s)} label={`${s.name} sync progress`} />
              <PillButton tone="glass" size="sm" onClick={() => test(s.sourceId)} disabled={busy}>Test connection</PillButton>
            </Bento>
          ))}
        </Grid>
      ) : null}

      {step === 3 ? (
        <Grid cols="1fr 1fr">
          <Bento tone="lavender" aria-label="First questions">
            <h2 className="eb-h">Seed your first questions</h2>
            {questions.length ? (
              <ul className="eb-list">
                {questions.map((q) => (
                  <li key={q}>
                    <PillLink tone="glass" href={`/ask?q=${encodeURIComponent(q)}`} style={{ margin: "3px 0" }}>{q}</PillLink>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="eb-body">Questions appear once the first sync has finished.</p>
            )}
          </Bento>
          <Bento tone="lime" fill>
            <h2 className="eb-h">Ready when you are</h2>
            <p className="eb-body">Initial sync: {formatNumber(itemsIndexed)} items indexed.</p>
            <PillLink tone="black" size="lg" href="/ask">Open Ask Brain →</PillLink>
          </Bento>
        </Grid>
      ) : null}

      <Bento tone="lavender" className="eb-row" style={{ justifyContent: "space-between" }} aria-label="Progress">
        <div className="eb-grow">
          <h2 className="eb-h">{step === 3 ? "You are set up" : STEPS[step + 1] ? `Next: ${STEPS[step + 1]}` : ""}</h2>
          <p className="eb-note">
            Initial sync: {formatNumber(itemsIndexed)} items indexed{syncProgress !== undefined ? ` · ${Math.round(syncProgress * 100)}% of the first source` : synced ? " · sources synced" : ""}
          </p>
        </div>
        {step > 0 ? <PillButton tone="outline" onClick={() => go(step - 1)}>Back</PillButton> : null}
        {step < 3 ? (
          <PillButton tone="lime" size="lg" onClick={() => go(step + 1)}>Continue →</PillButton>
        ) : null}
      </Bento>
    </div>
  );
}
