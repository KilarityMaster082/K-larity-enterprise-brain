"use client";
// Owner task: EB-23 Web UI shell — overlays open over whatever page is showing and live in the URL, so they can be
// linked, reloaded and closed with Back: ?source= (Evidence Side-Sheet, screen 2), ?view= (file viewers, 30–37),
// ?run= (agent run inspector, 25) and ?compose= (email composer, 7). Closing removes only that parameter.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { ComposerDrawer } from "./ComposerDrawer";
import { EvidenceSheet } from "./EvidenceSheet";
import { FileViewer } from "./FileViewer";
import { RunInspector } from "./RunInspector";

export const OVERLAY_PARAMS = ["source", "view", "run", "compose"] as const;
export type OverlayParam = (typeof OVERLAY_PARAMS)[number];

/** URL that opens an overlay on the current page (used by links and buttons). */
export function overlayHref(pathname: string, search: URLSearchParams, name: OverlayParam, value: string, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams(search.toString());
  for (const p of OVERLAY_PARAMS) q.delete(p); // one overlay at a time
  q.delete("mode");
  q.set(name, value);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return `${pathname}?${q.toString()}`;
}

export function OverlayHost({ tenantId }: { tenantId: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams();

  const close = useCallback(
    (name: OverlayParam) => {
      const q = new URLSearchParams(search.toString());
      q.delete(name);
      const rest = q.toString();
      router.replace(rest ? `${pathname}?${rest}` : pathname, { scroll: false });
    },
    [pathname, router, search],
  );

  const source = search.get("source");
  const compose = search.get("compose");
  return (
    <>
      <EvidenceSheet id={source} tenantId={tenantId} onClose={() => close("source")} />
      <FileViewer id={search.get("view")} onClose={() => close("view")} />
      <RunInspector runId={search.get("run")} onClose={() => close("run")} />
      {compose ? <ComposerDrawer key={compose} threadId={compose} tenantId={tenantId} mode={search.get("mode") ?? undefined} onClose={() => { const q = new URLSearchParams(search.toString()); q.delete("compose"); q.delete("mode"); const rest = q.toString(); router.replace(rest ? `${pathname}?${rest}` : pathname, { scroll: false }); }} /> : null}
    </>
  );
}
