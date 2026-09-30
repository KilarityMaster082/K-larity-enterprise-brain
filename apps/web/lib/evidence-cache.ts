// Owner task: EB-50 Ask Brain UI — citations open the Evidence Side-Sheet by URL (?source=<id>) so the state is
// shareable and Back closes it. Evidence that arrived with a streamed answer is remembered here so the sheet
// can show it at once; anything else is fetched from /api/evidence/[id], which re-checks permissions.
import type { Evidence } from "./contracts";

export interface Remembered {
  evidence: Evidence;
  /** The claims this evidence supports in the answer that cited it. */
  citedFor: string[];
  /** 1-based position among the answer's sources ("Source 1"). */
  number?: number;
}

// Keyed by tenant as well as id: a workspace switch must never surface the previous workspace's evidence.
const cache = new Map<string, Remembered>();
const key = (tenantId: string, id: string) => `${tenantId}\u0000${id}`;

export function rememberEvidence(tenantId: string, item: Remembered): void {
  cache.set(key(tenantId, item.evidence.id), item);
}

export function recallEvidence(tenantId: string, id: string): Remembered | undefined {
  return cache.get(key(tenantId, id));
}

export function forgetEvidence(): void {
  cache.clear();
}
