// Owner task: EB-88 Tenant admin console — retrieval test console. Shows ranked chunks for a query, with scores
// and ACL tokens, "as" a chosen kind of user so permission filtering can be checked. Tenant content is shown only
// during an audited impersonation of that tenant.
import { EmptyState, PageHeader } from "@klarity/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getTenant, SEARCH_AS } from "@/lib/data";
import { getOperator } from "@/lib/session";

import { RetrievalConsole } from "./RetrievalConsole";

export const metadata: Metadata = { title: "Retrieval console" };

export default async function RetrievalPage() {
  const s = await getOperator();
  if (!s) redirect("/login?next=/retrieval");
  const t = s.impersonating ? getTenant(s.impersonating.tenantId) : undefined;
  return (
    <div className="content content-wide">
      <PageHeader title="Retrieval console" lead="Check what the index returns for a question, and what each kind of user is allowed to see." />
      {t ? (
        <RetrievalConsole tenantName={t.name} searchAs={SEARCH_AS.map(({ id, label }) => ({ id, label }))} />
      ) : (
        <EmptyState
          icon="lock"
          title="Start an audited view of a tenant first"
          action={
            <Link className="btn btn-primary" href="/tenants">
              Choose a tenant
            </Link>
          }
        >
          <p>Operators see tenant content only while viewing that tenant, with a reason, for 30 minutes. Every query is recorded.</p>
        </EmptyState>
      )}
    </div>
  );
}
