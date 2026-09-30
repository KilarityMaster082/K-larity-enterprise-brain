// Owner task: EB-100 Admin console shell — System Audit Trail Explorer (screen 53): provisioning, suspensions, plan changes,
// dead-letter replays, gateway budget changes, retrieval queries and every impersonation start and end, with the reason given.
import { Bento } from "@klarity/ui";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { OpScreen } from "@/components/OpScreen";
import { auditLog } from "@/lib/data";
import { getOperator } from "@/lib/session";

import { AuditTable } from "./AuditTable";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage() {
  if (!(await getOperator())) redirect("/login?next=/audit");
  const rows = auditLog();
  const imp = rows.filter((r) => r.action.startsWith("impersonation")).length;
  const queries = rows.filter((r) => r.action === "retrieval.query").length;
  return (
    <OpScreen
      n={53}
      brief={[
        { label: "Events", value: rows.length, note: "append-only, newest first", tone: "sky" },
        { label: "Impersonation events", value: imp, note: "start and end, with reason", tone: "lavender" },
        { label: "Audited queries", value: queries, note: "retrieval console", tone: "lime" },
        { label: "Last event", value: rows[0]?.action ?? "—", note: rows[0]?.operator ?? "", tone: "cream" },
      ]}
    >
      <Bento tone="strong" aria-label="Audit log">
        <AuditTable rows={rows} />
      </Bento>
    </OpScreen>
  );
}
