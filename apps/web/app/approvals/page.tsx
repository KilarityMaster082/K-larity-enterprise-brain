// Owner task: EB-66 Approval model skeleton
// Status: designed placeholder (EB-23 shell) — data arrives with the owning task.
import type { Metadata } from "next";

import { NoAccess, PagePlaceholder } from "@/components/ui/PagePlaceholder";
import { requirePage } from "@/lib/guard";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const { allowed } = await requirePage("/approvals");
  if (!allowed) return <NoAccess what="approvals" />;
  return (
    <PagePlaceholder
      title="Approvals"
      lead="Nothing leaves K!larity without a person approving it."
      icon="approvals"
      emptyTitle="No approvals waiting"
      emptyBody="Drafted messages, tasks and other actions suggested by the Brain wait here until someone with the right role approves them."
      willShow={[
        "Pending drafts with who requested them and why",
        "The evidence behind each suggestion",
        "Approve, edit or reject — every choice is audited"
      ]}
    />
  );
}
