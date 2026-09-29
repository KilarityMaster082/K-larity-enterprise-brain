// Owner task: EB-53 Decision Memory
// Status: designed placeholder (EB-23 shell) — data arrives with the owning task.
import type { Metadata } from "next";

import { NoAccess, PagePlaceholder } from "@/components/ui/PagePlaceholder";
import { requirePage } from "@/lib/guard";

export const metadata: Metadata = { title: "Decisions" };

export default async function DecisionsPage() {
  const { allowed } = await requirePage("/decisions");
  if (!allowed) return <NoAccess what="decisions" />;
  return (
    <PagePlaceholder
      title="Decisions"
      lead="What was decided, by whom, when — confirmed by your team."
      icon="decisions"
      emptyTitle="No decisions to review"
      emptyBody="Draft decisions found in messages and emails will wait here for a project lead to confirm, edit or reject."
      willShow={[
        "Draft decisions waiting for review",
        "Confirmed decision log per project",
        "Alternatives, cost and time impact",
        "Links to the source messages"
      ]}
    />
  );
}
