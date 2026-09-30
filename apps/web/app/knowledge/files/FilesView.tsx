"use client";
// Owner task: EB-104 Knowledge hub — file vault client: folder tree, drag-and-drop upload zone, live parsing progress,
// and rename / delete / copy path / new folder. Uploads are registered with the server, which tracks parsing progress.
import { Bento, Icon, Modal, Pill, PillButton, ProgressTrack, useToast } from "@klarity/ui";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { useOverlay } from "@/components/overlays/useOverlay";
import { createFolderAction, deleteEntryAction, renameEntryAction, uploadFilesAction, type ActionResult } from "@/lib/data/actions";
import type { VaultFile } from "@/lib/data/types";

interface Node {
  folderId: string;
  name: string;
  depth: number;
  children: number;
  files: number;
}
type FileRow = VaultFile & { path: string };

const STATUS: Record<VaultFile["status"], string> = { parsed: "Parsed", ocr: "Parsing", uploading: "Uploading", failed: "Failed" };

export function FilesView({ tree, files, current, canWrite, canDelete, syncing }: { tree: Node[]; files: FileRow[]; current?: string; canWrite: boolean; canDelete: boolean; syncing: boolean }) {
  const router = useRouter();
  const search = useSearchParams();
  const open = useOverlay();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [drag, setDrag] = useState(false);
  const [dialog, setDialog] = useState<null | { kind: "new" } | { kind: "rename"; entry: "folder" | "file"; id: string; name: string }>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!syncing) return;
    const t = setInterval(() => router.refresh(), 1500);
    return () => clearInterval(t);
  }, [syncing, router]);

  const inFolder = files.filter((f) => f.folderId === current);
  const uploading = files.filter((f) => f.status !== "parsed");
  const go = (id: string) => {
    const q = new URLSearchParams(search.toString());
    q.set("folder", id);
    router.push(`/knowledge/files?${q.toString()}`, { scroll: false });
  };

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

  function upload(list: FileList | File[]) {
    if (!current) return;
    const items = Array.from(list).map((f) => ({ name: f.name, bytes: f.size }));
    if (items.length) run(uploadFilesAction(current, items));
  }

  const currentNode = tree.find((t) => t.folderId === current);

  return (
    <div className="eb-grid" style={{ ["--cols" as string]: "250px 1fr", alignItems: "start" }}>
      <Bento tone="strong" aria-label="Folders">
        <div className="eb-row" style={{ justifyContent: "space-between" }}>
          <h2 className="eb-eyebrow">File vault</h2>
          {canWrite ? <PillButton size="sm" onClick={() => setDialog({ kind: "new" })} title="New folder inside the selected folder"><Icon name="plus" size={11} /> Folder</PillButton> : null}
        </div>
        <ul className="eb-tree" role="tree" aria-label="Folders">
          {tree.map((n) => (
            <li key={n.folderId} role="treeitem" aria-selected={n.folderId === current} style={{ paddingLeft: n.depth * 14 }}>
              <button type="button" className="eb-folder" data-active={n.folderId === current || undefined} onClick={() => go(n.folderId)}>
                <Icon name="projects" size={12} /> <span className="eb-grow eb-trunc" style={{ textAlign: "left" }}>{n.name}</span>
                <span className="eb-note dim">{n.files || ""}</span>
              </button>
            </li>
          ))}
        </ul>
      </Bento>

      <div className="eb-stack">
        {canWrite ? (
          <div
            className="eb-drop"
            data-over={drag || undefined}
            role="button"
            tabIndex={0}
            aria-label="Drop files to upload, or press Enter to choose files"
            onClick={() => input.current?.click()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
          >
            Drop files to upload · batch parsing{currentNode ? ` into ${currentNode.name}` : ""}
            <input ref={input} type="file" multiple className="visually-hidden" tabIndex={-1} onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = ""; }} />
          </div>
        ) : null}

        {uploading.length ? (
          <Bento tone="sky" aria-label="Uploads in progress" aria-live="polite">
            {uploading.map((u) => (
              <div key={u.fileId} className="eb-row nowrap" style={{ marginBottom: 8 }}>
                <span className="eb-trunc" style={{ width: 200, fontWeight: 600 }}>{u.name}</span>
                <div className="eb-grow"><ProgressTrack pct={u.progress} label={`${u.name}: ${STATUS[u.status]} ${u.progress}%`} /></div>
                <span className="eb-note" style={{ width: 90, textAlign: "right" }}>{u.status === "ocr" ? `OCR ${u.progress}%` : STATUS[u.status]}</span>
              </div>
            ))}
          </Bento>
        ) : null}

        <Bento tone="white" aria-label={`Files in ${currentNode?.name ?? "this folder"}`}>
          {inFolder.length ? (
            <ul className="eb-list">
              {inFolder.map((f) => (
                <li key={f.fileId} className="eb-li">
                  <Pill tone="mono">{f.ext}</Pill>
                  {f.documentId ? (
                    <button type="button" className="eb-linklike eb-grow eb-li-title" onClick={() => open("view", f.documentId!)}>{f.name}</button>
                  ) : (
                    <span className="eb-grow eb-li-title">{f.name}</span>
                  )}
                  <span className="eb-li-sub">{f.status === "parsed" ? f.meta : STATUS[f.status]}</span>
                  <span className="eb-row nowrap" style={{ gap: 4 }}>
                    <button type="button" className="eb-linklike eb-note" onClick={() => void navigator.clipboard?.writeText(f.path).then(() => toast("Path copied."))}>Copy path</button>
                    {canWrite ? <button type="button" className="eb-linklike eb-note" onClick={() => setDialog({ kind: "rename", entry: "file", id: f.fileId, name: f.name })}>Rename</button> : null}
                    {canDelete ? <button type="button" className="eb-linklike eb-note eb-danger" onClick={() => { if (confirm(`Delete “${f.name}” from the vault? The original stays in its source.`)) run(deleteEntryAction("file", f.fileId)); }}>Delete</button> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="eb-body">This folder is empty.{canWrite ? " Drop files above to add some." : ""}</p>
          )}
          {currentNode && canDelete ? (
            <div className="eb-row" style={{ marginTop: 8 }}>
              <button type="button" className="eb-linklike eb-note" onClick={() => setDialog({ kind: "rename", entry: "folder", id: currentNode.folderId, name: currentNode.name })}>Rename folder</button>
              <button type="button" className="eb-linklike eb-note eb-danger" onClick={() => { if (confirm(`Delete the folder “${currentNode.name}”? It must be empty.`)) run(deleteEntryAction("folder", currentNode.folderId)); }}>Delete folder</button>
            </div>
          ) : null}
        </Bento>
      </div>

      <Modal open={dialog?.kind === "new"} onClose={() => setDialog(null)} title="New folder">
        <form
          className="eb-stack"
          onSubmit={(e) => {
            e.preventDefault();
            run(createFolderAction(current, String(new FormData(e.currentTarget).get("name") ?? "")), () => setDialog(null));
          }}
        >
          <label className="eb-label">Folder name<input name="name" className="eb-input" required maxLength={80} autoFocus /></label>
          <div><PillButton type="submit" tone="black" size="lg" disabled={busy}>Create</PillButton></div>
        </form>
      </Modal>
      <Modal open={dialog?.kind === "rename"} onClose={() => setDialog(null)} title="Rename">
        {dialog?.kind === "rename" ? (
          <form
            className="eb-stack"
            onSubmit={(e) => {
              e.preventDefault();
              run(renameEntryAction(dialog.entry, dialog.id, String(new FormData(e.currentTarget).get("name") ?? "")), () => setDialog(null));
            }}
          >
            <label className="eb-label">New name<input name="name" className="eb-input" required maxLength={160} defaultValue={dialog.name} autoFocus /></label>
            <div><PillButton type="submit" tone="black" size="lg" disabled={busy}>Rename</PillButton></div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}
