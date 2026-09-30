"use client";
// Owner task: EB-23 Web UI shell — a pill that opens an overlay (?compose=, ?view=, ?run=, ?source=) on the current page.
import { PillButton, type PillTone } from "@klarity/ui";
import type { ReactNode } from "react";

import type { OverlayParam } from "./OverlayHost";
import { useOverlay } from "./useOverlay";

export function OverlayButton({ name, value, extra, tone, size, children, title }: { name: OverlayParam; value: string; extra?: Record<string, string>; tone?: PillTone; size?: "sm" | "lg"; children: ReactNode; title?: string }) {
  const open = useOverlay();
  return (
    <PillButton tone={tone} size={size} title={title} onClick={() => open(name, value, extra)}>
      {children}
    </PillButton>
  );
}
