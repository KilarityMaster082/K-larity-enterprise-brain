// Owner task: EB-60 Executive dashboard
// Status: designed placeholder (EB-23 shell) — data arrives with the owning task.
import type { Metadata } from "next";

import { NoAccess, PagePlaceholder } from "@/components/ui/PagePlaceholder";
import { requirePage } from "@/lib/guard";

export const metadata: Metadata = { title: "Executive" };

export default async function ExecutivePage() {
  const { allowed } = await requirePage("/executive");
  if (!allowed) return <NoAccess what="the executive view" />;
  return (
    <PagePlaceholder
      title="Executive"
      lead="The state of the firm in under two minutes."
      icon="executive"
      emptyTitle="Nothing to show yet"
      emptyBody="The executive view fills in as projects, finance and decisions come online."
      willShow={[
        "Cash and receivables",
        "Projects at risk and why",
        "Decisions waiting and overdue items",
        "Today's attention list, each item with evidence"
      ]}
    />
  );
}
