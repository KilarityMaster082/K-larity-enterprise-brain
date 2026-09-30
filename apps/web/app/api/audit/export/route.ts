// Owner task: EB-93 Settings: connected sources and members — GET /api/audit/export: the tenant's audit log as CSV.
// Owners only (security.manage), this tenant only, and the export is itself written to the audit log. Cells that a
// spreadsheet could read as a formula are prefixed with an apostrophe (CSV injection).
import { activeMembership, getSession } from "@/lib/auth/session";
import { recordAuditExport, tenantView } from "@/lib/data/store";
import { can } from "@/lib/permissions";

const cell = (v: string | undefined): string => {
  let s = v ?? "";
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export async function GET() {
  const session = await getSession();
  if (!session) return new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401, headers: { "content-type": "application/json" } });
  const m = activeMembership(session);
  if (!can(m.role, "security.manage")) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "content-type": "application/json" } });
  const view = tenantView(m.tenantId, m.slug);
  const rows = [...view.audit].sort((a, b) => a.at.localeCompare(b.at));
  const csv = ["id,at,actor,action,target,detail", ...rows.map((a) => [a.id, a.at, a.actor, a.action, a.target, a.detail].map(cell).join(","))].join("\r\n") + "\r\n";
  recordAuditExport(m.tenantId, m.slug, session.user.name, rows.length);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="audit-${m.slug}.csv"`,
      "cache-control": "no-store",
    },
  });
}
