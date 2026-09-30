"use client";
// Owner task: EB-107 Apps and settings screens — scope switches and the Test / Connect / Reconnect / Disconnect buttons of an
// app. Every change goes through a server action that checks the role and writes an audit event.
import { PillButton, useToast } from "@klarity/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { connectSourceAction, disconnectSourceAction, reconnectSourceAction, setAppScopesAction, testConnectionAction } from "@/lib/data/actions";

export function AppControls({ appId, kind, scopes, disabled, connected, connectable, sourceId, needsAuth, connectorType }: { appId: string; kind: "connector" | "mcp"; scopes: string[]; disabled: string[]; connected: boolean; connectable: boolean; sourceId?: string; needsAuth: boolean; connectorType?: string }) {
  const [off, setOff] = useState<string[]>(disabled);
  const [account, setAccount] = useState("");
  const [busy, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  function done(res: { ok: boolean; message?: string; error?: string }) {
    if (res.ok) toast(res.message ?? "Done.");
    else toast(res.error ?? "That did not work.", "danger");
    router.refresh();
  }
  function toggle(scope: string) {
    const next = off.includes(scope) ? off.filter((s) => s !== scope) : [...off, scope];
    const prev = off;
    setOff(next);
    start(async () => {
      const res = await setAppScopesAction(appId, next);
      if (!res.ok) setOff(prev);
      done(res as { ok: boolean; message?: string; error?: string });
    });
  }

  return (
    <div style={{ marginTop: 16 }}>
      <h3 className="eb-h">Sync scopes</h3>
      <ul className="eb-list" aria-label="Scopes">
        {scopes.map((s) => (
          <li key={s} className="eb-li">
            <label className="eb-row eb-grow" style={{ gap: 8 }}>
              <input type="checkbox" className="eb-check" checked={!off.includes(s)} disabled={busy || !connected} onChange={() => toggle(s)} />
              <span className="eb-mono">{s}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="eb-row" style={{ gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        {connected && sourceId ? (
          <>
            <PillButton tone="outline" disabled={busy} onClick={() => start(async () => done(await testConnectionAction(sourceId)))}>Test connection</PillButton>
            {needsAuth ? <PillButton tone="black" disabled={busy} onClick={() => start(async () => done(await reconnectSourceAction(sourceId)))}>Reconnect</PillButton> : null}
            <PillButton tone="outline" disabled={busy} onClick={() => start(async () => done(await disconnectSourceAction(sourceId)))}>Disconnect</PillButton>
          </>
        ) : connectable && connectorType ? (
          <form className="eb-row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (account.trim()) start(async () => done(await connectSourceAction(connectorType, account.trim()))); }}>
            <label><span className="visually-hidden">Account to connect</span><input className="eb-input" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="account@your-firm.in" type="email" /></label>
            <PillButton tone="black" type="submit" disabled={busy || !account.trim()}>Connect</PillButton>
          </form>
        ) : (
          <p className="eb-note">{kind === "mcp" ? "MCP tools are enabled through the LLM gateway by a K!larity operator. Ask support to turn this one on for your workspace." : "This connector is not available for this workspace yet."}</p>
        )}
      </div>
    </div>
  );
}
