"use client";
// Owner task: EB-23 Web UI shell — open an overlay (?source=, ?view=, ?run=, ?compose=) from any client component.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { overlayHref, type OverlayParam } from "./OverlayHost";

export function useOverlay() {
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams();
  return useCallback(
    (name: OverlayParam, value: string) => {
      router.push(overlayHref(pathname, new URLSearchParams(search.toString()), name, value), { scroll: false });
    },
    [pathname, router, search],
  );
}
