"use client";
// Owner task: EB-103 Communications hub — small client pieces of the thread view: "Send to Decision Log", opening an
// attachment in the viewer, and marking the thread read once it has been opened.
import { PillButton, useToast } from "@klarity/ui";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

import { useOverlay } from "@/components/overlays/useOverlay";
import { markThreadReadAction, sendToDecisionLogAction } from "@/lib/data/actions";

export function ThreadActions({ threadId, index, existing }: { threadId: string; index: number; existing?: string }) {
  const [busy, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  if (existing) {
    return (
      <PillButton tone="black" size="sm" onClick={() => router.push(`/decisions?focus=${existing}`)}>
        In the decision queue →
      </PillButton>
    );
  }
  return (
    <PillButton
      tone="black"
      size="sm"
      disabled={busy}
      onClick={() =>
        start(async () => {
          const res = await sendToDecisionLogAction(threadId, index);
          if (res.ok) {
            toast("Sent to the decision queue as a draft. A person still has to confirm it.");
            router.refresh();
          } else toast(res.error, "danger");
        })
      }
    >
      Send to Decision Log →
    </PillButton>
  );
}

export function OpenDocument({ documentId, label, title }: { documentId: string; label: string; title?: string }) {
  const open = useOverlay();
  return (
    <PillButton tone="outline" onClick={() => open("view", documentId)} title={title}>
      {label}
    </PillButton>
  );
}

export function MarkRead({ threadId, unread }: { threadId: string; unread: boolean }) {
  useEffect(() => {
    if (unread) void markThreadReadAction(threadId);
  }, [threadId, unread]);
  return null;
}
