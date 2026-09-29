// Owner task: EB-57 Documents view — find the latest revision of any document or drawing in seconds.
import { PageHeader } from "@klarity/ui";
import type { Metadata } from "next";

import { NoAccess, NotSyncedYet } from "@/components/page/common";
import { evidenceById } from "@/lib/data/store";
import { pageContext } from "@/lib/page";

import { DocumentsView, type DocRow } from "./DocumentsView";

export const metadata: Metadata = { title: "Documents" };

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ doc?: string; project?: string; q?: string }> }) {
  const ctx = await pageContext("/documents", "documents.view");
  if (!ctx.allowed) return <NoAccess what="documents" />;
  const sp = await searchParams;
  const { data } = ctx.view;
  const name = (id: string) => data.projects.find((p) => p.projectId === id)?.name ?? id;
  const showMoney = ctx.can("finance.view");
  const rows: DocRow[] = data.documents.map((d) => ({
    ...d,
    amount: showMoney ? d.amount : undefined,
    projectName: name(d.projectId),
    evidence: evidenceById(ctx.view, [d.evidenceId]),
  }));
  return (
    <div className="content content-wide">
      <PageHeader title="Documents" lead="Drawings, quotations, contracts and reports across every source — latest revision first." />
      {rows.length ? (
        <DocumentsView
          rows={rows}
          projects={data.projects.map((p) => ({ id: p.projectId, name: p.name }))}
          initialDoc={sp.doc}
          initialProject={sp.project}
          initialQuery={sp.q}
        />
      ) : (
        <NotSyncedYet what="documents" />
      )}
    </div>
  );
}
