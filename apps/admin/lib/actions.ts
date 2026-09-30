"use server";
// Owner task: EB-88 Tenant admin console — operator actions. Each verifies the signed operator session and
// writes an audit event. Impersonation requires a reason, expires after 30 minutes and is always audited.
import { safeNext } from "@klarity/web-auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { AdminError, audit, changePlan, getTenant, provisionTenant, setStatus } from "./data";
import { dismissDeadLetter, replayDeadLetter, setGatewayBudget } from "./ops";
import { adminAuthMode, clearOperator, getOperator, IMPERSONATION_MINUTES, writeOperator } from "./session";

export type Result = { ok: true; message?: string } | { ok: false; error: string };

async function op() {
  const s = await getOperator();
  if (!s) throw new AdminError("your operator session has expired — sign in again");
  return s;
}

async function run(fn: () => Promise<string | undefined>, paths: string[]): Promise<Result> {
  try {
    const message = await fn();
    for (const p of paths) revalidatePath(p);
    return { ok: true, message };
  } catch (e) {
    if (e instanceof AdminError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function devOperatorSignIn(formData: FormData): Promise<void> {
  if (adminAuthMode() !== "dev") throw new Error("development sign-in is disabled");
  await writeOperator({ operator: { id: "op-dev", name: "Demo operator", email: "ops@klarity.example" } });
  redirect(safeNext(formData.get("next"), "/tenants"));
}

export async function operatorSignOut(): Promise<void> {
  const s = await getOperator();
  if (s?.impersonating) audit(s.operator.name, "impersonation.end", getTenant(s.impersonating.tenantId)?.slug, undefined, "signed out");
  await clearOperator();
  redirect("/login");
}

export async function provisionAction(input: { name: string; slug: string; tier: string; plan: string }): Promise<Result> {
  return run(async () => {
    const s = await op();
    const t = provisionTenant(s.operator.name, input);
    return t.tenantId;
  }, ["/tenants"]);
}

export async function setStatusAction(tenantId: string, status: "active" | "suspended", reason: string): Promise<Result> {
  return run(async () => {
    const s = await op();
    const t = setStatus(s.operator.name, tenantId, status, reason);
    return `${t.name} is now ${t.status}.`;
  }, ["/tenants", `/tenants/${tenantId}`]);
}

export async function changePlanAction(tenantId: string, plan: string, reason: string): Promise<Result> {
  return run(async () => {
    const s = await op();
    const t = changePlan(s.operator.name, tenantId, plan, reason);
    return `${t.name} moved to the ${t.plan} plan.`;
  }, ["/tenants", `/tenants/${tenantId}`]);
}

export async function startImpersonationAction(tenantId: string, reason: string): Promise<Result> {
  return run(async () => {
    const s = await op();
    const t = getTenant(tenantId);
    if (!t) throw new AdminError("tenant not found");
    if (t.status !== "active") throw new AdminError("only active tenants can be viewed");
    const why = reason.trim();
    if (why.length < 10) throw new AdminError("give a reason of at least 10 characters (e.g. the support ticket)");
    if (s.impersonating) audit(s.operator.name, "impersonation.end", getTenant(s.impersonating.tenantId)?.slug, undefined, "replaced");
    const now = Date.now();
    await writeOperator({
      operator: s.operator,
      exp: s.exp,
      impersonating: { tenantId, reason: why.slice(0, 300), startedAt: new Date(now).toISOString(), expiresAt: new Date(now + IMPERSONATION_MINUTES * 60_000).toISOString() },
    });
    audit(s.operator.name, "impersonation.start", t.slug, why);
    return `Viewing ${t.name} for ${IMPERSONATION_MINUTES} minutes. Every query is audited.`;
  }, ["/", "/tenants", "/retrieval", "/audit"]);
}

export async function stopImpersonationAction(): Promise<Result> {
  return run(async () => {
    const s = await op();
    if (s.impersonating) audit(s.operator.name, "impersonation.end", getTenant(s.impersonating.tenantId)?.slug);
    await writeOperator({ operator: s.operator, exp: s.exp });
    return "Stopped viewing the tenant.";
  }, ["/", "/tenants", "/retrieval", "/audit"]);
}

export async function replayDeadLetterAction(id: string, reason: string): Promise<Result> {
  return run(async () => {
    const s = await op();
    const d = replayDeadLetter(s.operator.name, id, reason);
    return `Replay started for ${d.itemRef}. It runs under the same idempotency key, so nothing is ingested twice.`;
  }, ["/dead-letter", "/sources-health", "/audit", "/tenants"]);
}

export async function dismissDeadLetterAction(id: string, reason: string): Promise<Result> {
  return run(async () => {
    const s = await op();
    dismissDeadLetter(s.operator.name, id, reason);
    return "Dismissed. The item stays in the audit log.";
  }, ["/dead-letter", "/sources-health", "/audit"]);
}

export async function setGatewayBudgetAction(tenantId: string, capUsd: number, reason: string): Promise<Result> {
  return run(async () => {
    const s = await op();
    setGatewayBudget(s.operator.name, tenantId, capUsd, reason);
    return `Monthly cap set to $${Math.round(capUsd)}.`;
  }, ["/gateway", "/audit"]);
}
