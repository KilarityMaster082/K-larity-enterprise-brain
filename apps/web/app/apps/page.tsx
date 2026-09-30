// Owner task: EB-107 Apps and settings screens — App Store & Tool Catalog (screen 38): connectors and MCP tools the
// workspace can use, filtered All / Installed / Available. "Installed" follows the live sources, not a stored flag.
import { Bento, BentoHead, Grid, Pill } from "@klarity/ui";
import type { Metadata } from "next";
import Link from "next/link";

import { NoAccess } from "@/components/page/common";
import { Brief, Screen, presenceOf } from "@/components/page/Screen";
import { appsBrief } from "@/lib/briefs";
import { pageContext } from "@/lib/page";
import { appRows, toneFor } from "@/lib/workspace";

export const metadata: Metadata = { title: "Apps" };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "installed", label: "Installed" },
  { key: "available", label: "Available" },
] as const;

const STATUS = { connected: { label: "Connected", tone: "green" }, attention: { label: "Needs attention", tone: "pink" }, available: { label: "Available", tone: "outline" } } as const;

export default async function AppsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const ctx = await pageContext("/apps", "apps.manage");
  if (!ctx.allowed) return <NoAccess what="the app catalog" />;
  const { filter } = await searchParams;
  const active = FILTERS.some((f) => f.key === filter) ? filter! : "all";
  const { view, session } = ctx;
  const all = appRows(view);
  const rows = all.filter((a) => (active === "installed" ? a.liveStatus !== "available" : active === "available" ? a.liveStatus === "available" : true));
  return (
    <Screen n={38} brief={<Brief metrics={appsBrief(view)} live={presenceOf(view.members, session.user)} />}>
      <div className="eb-row" role="group" aria-label="Filter apps" style={{ gap: 8, marginBottom: 12 }}>
        {FILTERS.map((f) => (
          <Link key={f.key} href={f.key === "all" ? "/apps" : `/apps?filter=${f.key}`} className="eb-pill" data-active={f.key === active || undefined} aria-current={f.key === active ? "page" : undefined}>
            {f.label}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <Bento tone="strong"><p className="eb-body">No apps match this filter.</p></Bento>
      ) : (
        <Grid cols="repeat(3, minmax(0, 1fr))" align="stretch">
          {rows.map((a) => {
            const st = STATUS[a.liveStatus];
            return (
              <Bento key={a.appId} tone={toneFor(a.appId)} fill>
                <BentoHead title={a.name} aside={<Pill size="sm" tone={st.tone}>{st.label}</Pill>} />
                <p className="eb-note">{a.vendor} · {a.kind === "mcp" ? "MCP tool" : "Connector"} · {a.category}</p>
                <p className="eb-body" style={{ marginTop: 6 }}>{a.description}</p>
                <div style={{ marginTop: "auto", paddingTop: 12 }}>
                  <Link href={`/apps/${a.appId}`} className="eb-pill" data-tone="black" data-size="sm">{a.liveStatus === "available" ? "Set up" : "Manage"}</Link>
                </div>
              </Bento>
            );
          })}
        </Grid>
      )}
    </Screen>
  );
}
