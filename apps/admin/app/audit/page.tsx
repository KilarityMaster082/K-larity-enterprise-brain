// Owner task: EB-100 Admin console shell — operator audit view: provisioning, suspensions, plan changes and every
// impersonation start and end, with the reason given.
import { PageHeader } from "@klarity/ui";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auditLog } from "@/lib/data";
import { getOperator } from "@/lib/session";

import { AuditTable } from "./AuditTable";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage() {
  if (!(await getOperator())) redirect("/login?next=/audit");
  return (
    <div className="content content-wide">
      <PageHeader title="Audit log" lead="Every operator action, newest first. Impersonation always records who, which tenant, why and for how long." />
      <AuditTable rows={auditLog()} />
    </div>
  );
}
