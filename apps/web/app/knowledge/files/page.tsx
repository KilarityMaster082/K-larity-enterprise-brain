// Owner task: EB-104 Knowledge hub — Knowledge File Vault & Tree (screen 9): nested folders, batch upload with live parsing
// progress, and the file list. Files that have a parsed body open in the in-place viewers (screens 30–37).
import type { Metadata } from "next";

import { NoAccess } from "@/components/page/common";
import { Brief, Screen, presenceOf } from "@/components/page/Screen";
import { viewersBrief } from "@/lib/briefs";
import { pageContext } from "@/lib/page";
import { folderTree } from "@/lib/workspace";

import { FilesView } from "./FilesView";

export const metadata: Metadata = { title: "File vault" };

export default async function FilesPage({ searchParams }: { searchParams: Promise<{ folder?: string }> }) {
  const ctx = await pageContext("/knowledge/files", "knowledge.view");
  if (!ctx.allowed) return <NoAccess what="the file vault" />;
  const { folder } = await searchParams;
  const { view, session } = ctx;
  const w = view.data.workspace;
  const tree = folderTree(view);
  const current = w.folders.find((f) => f.folderId === folder)?.folderId ?? tree.find((t) => t.name === "Phoenix")?.folderId ?? tree[0]?.folderId;
  const path = (id: string): string => {
    const f = w.folders.find((x) => x.folderId === id);
    return f ? `${f.parentId ? `${path(f.parentId)}/` : ""}${f.name}` : "";
  };
  return (
    <Screen n={9} brief={<Brief metrics={viewersBrief(view)} live={presenceOf(view.members, session.user)} />}>
      <FilesView
        tree={tree}
        files={w.files.map((f) => ({ ...f, path: `${path(f.folderId)}/${f.name}` }))}
        current={current}
        canWrite={ctx.member.role !== "viewer"}
        canDelete={ctx.member.role === "owner" || ctx.member.role === "admin"}
        syncing={w.files.some((f) => f.status === "uploading" || f.status === "ocr")}
      />
    </Screen>
  );
}
