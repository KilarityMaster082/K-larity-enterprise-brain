"use client";
// Owner task: EB-94 First-run onboarding and empty-state journeys — a short setup strip above Ask until the workspace
// can answer: connect a source → first sync finishes → ask a first question. Refreshes itself while syncing.
// The full walkthrough is the Onboarding Wizard (/onboarding, screen 4).
import { Bento, Icon, PillLink, ProgressTrack } from "@klarity/ui";
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
  firstName,
  workspace,
  suggestions,
  scope,
  initialQuestion,
  onboarding,
  syncProgress,
  canConnect,
}: {
  firstName: string;
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

  const steps = [
    { key: "connect", done: onboarding.connected, title: "Connect a source" },
    { key: "sync", done: onboarding.synced, title: "First sync" },
    { key: "ask", done: onboarding.askedFirstQuestion, title: "Ask a first question" },
  ];
  const current = steps.findIndex((s) => !s.done);

  return (
    <div className="eb-stack">
      {!onboarding.done ? (
        <Bento tone="sky" aria-labelledby="setup-title">
          <div className="eb-row" style={{ justifyContent: "space-between" }}>
            <h2 id="setup-title" className="eb-eyebrow">
              First-run setup · {steps.filter((s) => s.done).length} of {steps.length} done
            </h2>
            {canConnect ? (
              <PillLink tone="black" href="/onboarding">
                Open the setup wizard <Icon name="arrowRight" size={12} />
              </PillLink>
            ) : (
              <span className="eb-note">Ask a workspace owner to connect a source.</span>
            )}
          </div>
          <ol className="eb-row" style={{ listStyle: "none", margin: "8px 0 0", padding: 0, gap: 14 }}>
            {steps.map((s, i) => (
              <li key={s.key} className="eb-row" style={{ fontWeight: i === current ? 600 : 400 }}>
                <span className="eb-avatar eb-avatar-sm" style={{ background: s.done ? "var(--eb-lime)" : "#fff" }}>
                  {s.done ? <Icon name="check" size={11} /> : i + 1}
                </span>
                {s.title}
                <span className="visually-hidden">{s.done ? " (done)" : i === current ? " (next step)" : ""}</span>
              </li>
            ))}
          </ol>
          {syncProgress !== undefined ? (
            <div style={{ marginTop: 8 }} role="status">
              <p className="eb-note">Reading your sources… {Math.round(syncProgress * 100)}%</p>
              <ProgressTrack pct={syncProgress * 100} label="First sync progress" />
            </div>
          ) : null}
        </Bento>
      ) : null}
      <AskView
        firstName={firstName}
        workspace={workspace}
        suggestions={onboarding.synced ? suggestions : []}
        scope={scope}
        initialQuestion={initialQuestion}
        onFirstAnswer={onboarding.done ? undefined : () => router.refresh()}
        disabledReason={onboarding.synced ? undefined : "No source has finished its first sync yet, so there is nothing to answer from."}
      />
    </div>
  );
}
