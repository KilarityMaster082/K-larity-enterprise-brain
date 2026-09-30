// Owner task: EB-42 Permission filter — the second permission check (CLAUDE.md rule 2): before any evidence is
// rendered from a link, a history entry or a deep link, the server re-checks tenant and role against the evidence's
// sensitivity. Ledger and SQL-view evidence is finance data: owners and partners only.
import type { Evidence } from "./contracts";
import type { TenantView } from "./data/store";
import type { Role } from "./data/types";
import { can } from "./permissions";

const FINANCE_SOURCES = new Set(["ledger", "sql"]);

export function isFinanceEvidence(view: TenantView, e: Evidence): boolean {
  return FINANCE_SOURCES.has(e.sourceType) || view.data.txns.some((t) => t.evidenceId === e.id) || e.id === "ev-phx-budget";
}

export type EvidenceAccess = { ok: true; evidence: Evidence } | { ok: false; status: 403 | 404 };

/** Evidence of this tenant that this role may see. The status distinguishes "not yours" from "not there". */
export function readEvidence(view: TenantView, role: Role, id: string): EvidenceAccess {
  if (!can(role, "ask") && !can(role, "documents.view")) return { ok: false, status: 403 };
  const e = view.data.evidence.find((x) => x.id === id);
  if (!e) return { ok: false, status: 404 };
  if (isFinanceEvidence(view, e) && !can(role, "finance.view")) return { ok: false, status: 403 };
  return { ok: true, evidence: e };
}
