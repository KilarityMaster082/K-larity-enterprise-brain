"use client";
// Owner task: EB-94 First-run onboarding and empty-state journeys — checklist above Ask until the workspace can
// answer: connect a source → first sync finishes → ask a first question. Refreshes itself while syncing.
import { Icon } from "@klarity/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { AskView } from "@/components/answer/AskView";

interface Onboarding {
  connected: boolean;
  synced: boolean;
  askedFirstQuestion: boolean;
  done: boolean;
}

export function AskScreen({
  workspace,
  suggestions,
  scope,
  initialQuestion,
  onboarding,
  syncProgress,
  canConnect,
}: {
  workspace: string;
  suggestions: string[];
  scope?: { id: string; name: string };
  initialQuestion?: string;
  onboarding: Onboarding;
  syncProgress?: number;
  canConnect: boolean;
}) {
  const router = useRouter();
  useEffect(() => {
    if (syncProgress === undefined) return;
    const t = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(t);
  }, [syncProgress, router]);

  return (
    <>
      {!onboarding.done ? (
        <Checklist onboarding={onboarding} syncProgress={syncProgress} canConnect={canConnect} />
      ) : null}
      <AskView
        workspace={workspace}
        suggestions={onboarding.synced ? suggestions : []}
        scope={scope}
        initialQuestion={initialQuestion}
        onFirstAnswer={onboarding.done ? undefined : () => router.refresh()}
      />
    </>
  );
}

function Checklist({ onboarding, syncProgress, canConnect }: { onboarding: Onboarding; syncProgress?: number; canConnect: boolean }) {
  const steps = [
    {
      key: "connect",
      done: onboarding.connected,
      title: "Connect a source",
      body: canConnect ? "Gmail, Google Drive, Sheets or a WhatsApp export." : "Ask a workspace owner to connect Gmail, Drive, Sheets or WhatsApp.",
      action: canConnect && !onboarding.connected ? <Link className="btn btn-primary btn-sm" href="/settings?tab=sources">Connect</Link> : null,
    },
    {
      key: "sync",
      done: onboarding.synced,
      title: "Wait for the first sync",
      body:
        syncProgress !== undefined
          ? `Reading your sources… ${Math.round(syncProgress * 100)}%`
          : onboarding.synced
            ? "Sources are synced."
            : "Starts as soon as a source is connected.",
      action:
        syncProgress !== undefined ? (
          <div className="meter-track" style={{ width: 120 }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(syncProgress * 100)} aria-label="First sync progress">
            <div className="meter-fill" style={{ width: `${syncProgress * 100}%`, background: "var(--brand)" }} />
          </div>
        ) : null,
    },
    {
      key: "ask",
      done: onboarding.askedFirstQuestion,
      title: "Ask your first question",
      body: "Every answer shows its sources. Try a project, a payment or a decision.",
      action: null,
    },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <section className="card card-pad stack" aria-labelledby="onboarding-title" style={{ marginBottom: "var(--s-6)" }}>
      <div className="row-between">
        <h2 id="onboarding-title" style={{ fontSize: "var(--fs-lg)" }}>
          Get your Brain ready
        </h2>
        <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
          {steps.filter((s) => s.done).length} of {steps.length} done
        </span>
      </div>
      <ol className="checklist">
        {steps.map((s, i) => (
          <li key={s.key} className="check-item" data-done={s.done} data-current={i === current}>
            <span className="check-dot" aria-hidden="true">
              {s.done ? <Icon name="check" size={14} /> : i + 1}
            </span>
            <span className="stack-sm" style={{ gap: 0 }}>
              <strong>
                {s.title}
                <span className="visually-hidden">{s.done ? " (done)" : i === current ? " (next step)" : ""}</span>
              </strong>
              <span className="muted" style={{ fontSize: "var(--fs-sm)" }} role={s.key === "sync" && syncProgress !== undefined ? "status" : undefined}>
                {s.body}
              </span>
            </span>
            {s.action}
          </li>
        ))}
      </ol>
    </section>
  );
}
