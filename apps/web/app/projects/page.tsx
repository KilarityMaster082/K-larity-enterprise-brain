// Owner task: EB-54 Project Brain page
// Status: designed placeholder (EB-23 shell) — data arrives with the owning task.
import type { Metadata } from "next";

import { NoAccess, PagePlaceholder } from "@/components/ui/PagePlaceholder";
import { requirePage } from "@/lib/guard";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const { allowed } = await requirePage("/projects");
  if (!allowed) return <NoAccess what="projects" />;
  return (
    <PagePlaceholder
      title="Projects"
      lead="Every project's timeline, people, drawings, decisions and money in one place."
      icon="projects"
      emptyTitle="No projects yet"
      emptyBody="Projects appear once email, WhatsApp and Drive are connected and the first sync finishes."
      willShow={[
        "Timeline of events and current stage",
        "People, latest drawings and open decisions",
        "Budget vs actual from the finance ledger",
        "An Ask box scoped to the project"
      ]}
    />
  );
}
