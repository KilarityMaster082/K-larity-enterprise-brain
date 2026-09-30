// Owner task: EB-107 Apps and settings screens — App Detail & Connection (screen 39): OAuth status, the webhook path, the
// scopes that sync (each can be switched off) and Test / Disconnect / Connect. Secrets are never shown: only a fingerprint.
import { Bento, BentoHead, Pill } from "@klarity/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";
import { notFound } from "next/navigation";

import { NoAccess } from "@/components/page/common";
import { Brief, Screen, presenceOf } from "@/components/page/Screen";
import { appsBrief } from "@/lib/briefs";
import { pageContext } from "@/lib/page";
import { appRows } from "@/lib/workspace";

import { AppControls } from "./AppControls";

export const metadata: Metadata = { title: "App" };

const OAUTH = { granted: "Granted", expired: "Expired: re-authorise", not_connected: "Not connected" } as const;

/** A short, stable, non-reversible tag for the stored credential so operators can tell keys apart without seeing them. */
function fingerprint(tenantId: string, appId: string): string {
  let h = 2166136261;
  for (const ch of `${tenantId}:${appId}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return `••••${h.toString(16).padStart(8, "0").slice(-4)}`;
}

export default async function AppPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await pageContext(`/apps/${id}`, "apps.manage");
  if (!ctx.allowed) return <NoAccess what="the app catalog" />;
  const { view, session, member } = ctx;
  const app = appRows(view).find((a) => a.appId === id);
  if (!app) notFound();
  const connected = app.liveStatus !== "available";
  return (
    <Screen n={39} brief={<Brief metrics={appsBrief(view)} live={presenceOf(view.members, session.user)} />}>
      <Bento tone="strong" aria-label={app.name}>
        <BentoHead title={app.name} aside={<Link href="/apps" className="eb-pill" data-size="sm">All apps</Link>} />
        <p className="eb-note">{app.vendor} · {app.kind === "mcp" ? "MCP tool" : "Connector"} · {app.category}</p>
        <p className="eb-body">{app.description}</p>
        <dl className="eb-kv" style={{ marginTop: 12 }}>
          <dt>Authorisation</dt><dd><Pill size="sm" tone={app.oauth === "granted" ? "green" : app.oauth === "expired" ? "pink" : "outline"}>{OAUTH[app.oauth]}</Pill></dd>
          <dt>Credential</dt><dd className="eb-mono">{connected ? fingerprint(member.tenantId, app.appId) : "none stored"}</dd>
          {app.webhookPath ? (<><dt>Webhook</dt><dd className="eb-mono">{app.webhookPath}</dd></>) : null}
          {app.sources.map((s) => (<Fragment key={s.sourceId}><dt>Source</dt><dd>{s.displayName} · {s.account}</dd></Fragment>))}
        </dl>
        <AppControls
          appId={app.appId}
          kind={app.kind}
          scopes={app.scopes}
          disabled={app.disabledScopes ?? []}
          connected={connected}
          connectable={Boolean(app.connectorType)}
          sourceId={app.sources[0]?.sourceId}
          needsAuth={app.oauth === "expired" || app.liveStatus === "attention"}
          connectorType={app.connectorType}
        />
      </Bento>
    </Screen>
  );
}
