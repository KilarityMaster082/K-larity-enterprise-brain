// Owner task: EB-55 Financial Brain page
// Status: designed placeholder (EB-23 shell) — data arrives with the owning task.
import type { Metadata } from "next";

import { NoAccess, PagePlaceholder } from "@/components/ui/PagePlaceholder";
import { requirePage } from "@/lib/guard";

export const metadata: Metadata = { title: "Finance" };

export default async function FinancePage() {
  const { allowed } = await requirePage("/finance");
  if (!allowed) return <NoAccess what="finance" />;
  return (
    <PagePlaceholder
      title="Finance"
      lead="Cash, receivables, budgets and variances — every number from the ledger."
      icon="finance"
      emptyTitle="Finance isn't connected yet"
      emptyBody="Connect the finance sheets to see budgets, invoices and payments here."
      willShow={[
        "Cash position and receivables ageing",
        "Budget vs actual per project and package",
        "Overdue client payments and vendor dues",
        "Leakage flags with their evidence"
      ]}
    />
  );
}
