// Owner task: EB-50 Ask Brain UI
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AskView } from "@/components/answer/AskView";
import { SUGGESTED_QUESTIONS } from "@/lib/fixtures/answers";
import { activeMembership, getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Ask Brain" };

export default async function AskPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/ask");
  const workspace = activeMembership(session);
  return (
    <div className="content">
      <AskView
        // Re-mount on tenant switch so no answer from the previous workspace stays on screen.
        key={workspace.tenantId}
        workspace={workspace.name}
        suggestions={workspace.slug === "studio8" ? SUGGESTED_QUESTIONS : SUGGESTED_QUESTIONS.slice(0, 2)}
      />
    </div>
  );
}
