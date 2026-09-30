// Owner task: EB-57 Documents view — Document & Drawing Vault (screen 15): find the latest revision of any document or
// drawing in seconds; each card opens the in-place viewer for its file type (screens 30–37) with ?view=<id>.
import type { Metadata } from "next";

import { NoAccess, NotSyncedYet } from "@/components/page/common";
import { Brief, Screen, presenceOf } from "@/components/page/Screen";
import { viewersBrief } from "@/lib/briefs";
import { can } from "@/lib/permissions";
import { evidenceById } from "@/lib/data/store";
import { extLabel, needsTechnicalRole, viewerKind } from "@/lib/files";
import { pageContext } from "@/lib/page";

import { DocumentsView, type DocRow } from "./DocumentsView";

export const metadata: Metadata = { title: "Documents" };

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ project?: string; q?: string }> }) {
  const ctx = await pageContext("/documents", "documents.view");
  if (!ctx.allowed) return <NoAccess what="documents" />;
  const sp = await searchParams;
  const { view, session, member } = ctx;
  const { data } = view;
  const name = (id: string) => (id ? (data.projects.find((p) => p.projectId === id)?.name ?? id) : "Workspace");
  const showMoney = ctx.can("finance.view");
  const rows: DocRow[] = data.documents
    .filter((d) => !needsTechnicalRole(viewerKind(d)) || can(member.role, "code.view"))
    .map((d) => ({
      ...d,
      amount: showMoney ? d.amount : undefined,
      projectName: name(d.projectId),
      ext: extLabel(d),
      evidence: evidenceById(view, [d.evidenceId]),
    }));
  return (
    <Screen n={15} brief={<Brief metrics={viewersBrief(view)} live={presenceOf(view.members, session.user)} />}>
      {rows.length ? (
        <DocumentsView rows={rows} projects={data.projects.map((p) => ({ id: p.projectId, name: p.name }))} initialProject={sp.project} initialQuery={sp.q} />
      ) : (
        <NotSyncedYet what="documents" canConnect={ctx.can("sources.manage")} />
      )}
    </Screen>
  );
}
