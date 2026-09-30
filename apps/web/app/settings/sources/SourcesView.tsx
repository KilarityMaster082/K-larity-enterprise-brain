"use client";
// Owner task: EB-93 Settings: connected sources and members — source cards and the connect dialog.
import { Bento, Grid, Icon, Modal, Pill, PillButton, ProgressTrack, formatDateTime, formatNumber, formatPercent, formatRelative, useToast, type IconName } from "@klarity/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { connectSourceAction, disconnectSourceAction, reconnectSourceAction, syncNowAction, testConnectionAction, type ActionResult } from "@/lib/data/actions";
import type { Source, SourceHealth } from "@/lib/data/types";

const HEALTH: Record<SourceHealth, { label: string; tone: "green" | "cream" | "pink" | "sky" | "glass" }> = {
  ok: { label: "Healthy", tone: "green" },
  degraded: { label: "Some errors", tone: "cream" },
  failing: { label: "Failing", tone: "pink" },
  auth_error: { label: "Needs reconnect", tone: "pink" },
  syncing: { label: "Syncing", tone: "sky" },
  never_run: { label: "Not synced yet", tone: "glass" },
};

const CONNECTORS: { type: Source["connectorType"]; label: string; icon: IconName; hint: string }[] = [
  { type: "gmail", label: "Gmail", icon: "mail", hint: "Mailbox address, e.g. partners@yourfirm.com" },
  { type: "drive", label: "Google Drive", icon: "documents", hint: "Shared drive or folder name" },
  { type: "sheets", label: "Google Sheets", icon: "sheet", hint: "Workbook name, e.g. Budget & billing 2026" },
  { type: "whatsapp", label: "WhatsApp export", icon: "chat", hint: "Group name of the exported chat" },
  { type: "calendar", label: "Google Calendar", icon: "calendar", hint: "Calendar account" },
  { type: "file_drop", label: "File drop folder", icon: "download", hint: "Folder name" },
];

export function SourcesView({ sources, syncProgress }: { sources: Source[]; syncProgress?: number }) {
  const [connecting, setConnecting] = useState(false);
  const [busy, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  useEffect(() => {
    if (syncProgress === undefined) return;
    const t = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(t);
  }, [syncProgress, router]);

  function run(p: Promise<ActionResult>, after?: () => void) {
    start(async () => {
      const res = await p;
      if (res.ok) {
        toast(res.message ?? "Saved.");
        after?.();
        router.refresh();
      } else toast(res.error, "danger");
    });
  }

  return (
    <div className="eb-stack">
      <div className="eb-row" style={{ justifyContent: "space-between" }}>
        <p className="eb-body" style={{ maxWidth: "68ch" }}>
          The Brain reads only what these sources share, and only people who can see an item at the source can see it here. Credentials are encrypted per workspace and never shown.
        </p>
        <PillButton tone="black" size="lg" onClick={() => setConnecting(true)}>
          <Icon name="plus" size={13} /> Connect a source
        </PillButton>
      </div>

      {sources.length ? (
        <Grid cols="repeat(3, minmax(0, 1fr))" align="stretch">
          {sources.map((s) => {
            const h = HEALTH[s.health];
            return (
              <Bento key={s.sourceId} tone={h.tone} fill aria-label={`${s.displayName}, ${h.label}`} style={{ minHeight: 150 }}>
                <div>
                  <div className="eb-row" style={{ justifyContent: "space-between" }}>
                    <h2 className="eb-h-lg">{s.displayName}</h2>
                    <Pill size="sm">{h.label}</Pill>
                  </div>
                  <p className="eb-li-sub">{s.account}</p>
                </div>
                {s.health === "syncing" ? (
                  <div role="status">
                    <p className="eb-note">{Math.round((syncProgress ?? 0) * 100)}% of this sync</p>
                    <ProgressTrack pct={(syncProgress ?? 0) * 100} label={`${s.displayName} sync progress`} />
                  </div>
                ) : (
                  <dl className="eb-kv">
                    <dt>Last cursor</dt>
                    <dd>{s.lastSyncAt ? <time dateTime={s.lastSyncAt} title={`${formatDateTime(s.lastSyncAt)} IST`}>{formatRelative(s.lastSyncAt)}</time> : "—"}</dd>
                    <dt>Items seen</dt>
                    <dd className="eb-num">{formatNumber(s.itemsSeen)}</dd>
                    <dt>Lag</dt>
                    <dd>{s.lagMinutes !== undefined ? `${s.lagMinutes} min` : "—"}</dd>
                    <dt>Errors (24 h)</dt>
                    <dd className="eb-num">{formatPercent(s.errorRate)}</dd>
                  </dl>
                )}
                {s.lastError ? <p className="eb-note eb-danger" role="note">{s.lastError}</p> : null}
                <div className="eb-row">
                  <PillButton tone="black" size="sm" disabled={busy || s.health === "syncing" || s.health === "auth_error"} onClick={() => run(syncNowAction(s.sourceId))}>
                    <Icon name="refresh" size={11} /> Sync now
                  </PillButton>
                  {s.health === "auth_error" ? <PillButton tone="lime" size="sm" disabled={busy} onClick={() => run(reconnectSourceAction(s.sourceId))}>Reconnect</PillButton> : null}
                  <PillButton size="sm" disabled={busy} onClick={() => run(testConnectionAction(s.sourceId))}>Test</PillButton>
                  <PillButton
                    tone="danger"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      if (confirm(`Disconnect ${s.displayName} (${s.account})? It stops syncing.`)) run(disconnectSourceAction(s.sourceId));
                    }}
                  >
                    Disconnect
                  </PillButton>
                </div>
              </Bento>
            );
          })}
        </Grid>
      ) : (
        <Bento tone="sky" pad="lg">
          <h2 className="eb-h-lg">No sources connected yet</h2>
          <p className="eb-body">Connect Gmail, Google Drive, Sheets or a WhatsApp export. The first sync starts straight away.</p>
        </Bento>
      )}

      <Modal open={connecting} onClose={() => setConnecting(false)} title="Connect a source">
        <form
          className="eb-stack"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(connectSourceAction(String(f.get("type")), String(f.get("account"))), () => setConnecting(false));
          }}
        >
          <fieldset style={{ border: 0, padding: 0, margin: 0 }} className="eb-stack tight">
            <legend className="eb-label" style={{ marginBottom: 6 }}>Source type</legend>
            {CONNECTORS.map((c, i) => (
              <label key={c.type} className="eb-row" style={{ fontSize: "var(--eb-t-sm)" }}>
                <input type="radio" name="type" value={c.type} defaultChecked={i === 0} /> <Icon name={c.icon} size={14} /> {c.label}
                <span className="eb-dim" style={{ fontSize: "var(--eb-t-xs)" }}>— {c.hint}</span>
              </label>
            ))}
          </fieldset>
          <label className="eb-label">
            Account or folder
            <input name="account" className="eb-input" required maxLength={120} placeholder="e.g. partners@yourfirm.com" />
          </label>
          <p className="eb-note">In development this simulates the Google sign-in and the first sync (about 12 seconds). Production opens the provider&apos;s consent screen; the token goes straight to the encrypted credential store.</p>
          <div>
            <PillButton type="submit" tone="black" size="lg" disabled={busy}>Connect</PillButton>
          </div>
        </form>
      </Modal>
    </div>
  );
}
