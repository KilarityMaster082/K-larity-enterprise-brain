// Owner task: EB-57 Documents view
// Status: designed placeholder (EB-23 shell) — data arrives with the owning task.
import type { Metadata } from "next";

import { NoAccess, PagePlaceholder } from "@/components/ui/PagePlaceholder";
import { requirePage } from "@/lib/guard";

export const metadata: Metadata = { title: "Documents" };

export default async function DocumentsPage() {
  const { allowed } = await requirePage("/documents");
  if (!allowed) return <NoAccess what="documents" />;
  return (
    <PagePlaceholder
      title="Documents"
      lead="Find the latest revision of any document or drawing in seconds."
      icon="documents"
      emptyTitle="No documents indexed yet"
      emptyBody="Documents and drawings from Drive and email attachments appear once they are indexed."
      willShow={[
        "Search across sources with filters for project, type, revision and date",
        "Latest-revision badges on drawings",
        "Preview with summary and extracted facts"
      ]}
    />
  );
}
