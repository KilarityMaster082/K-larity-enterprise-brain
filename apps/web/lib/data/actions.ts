"use server";
// Owner task: EB-23 Web UI shell — server actions behind every button that changes data. Each one checks the
// signed session and the role's capability on the server, then writes an audit event through the store.
// Nothing here sends a message or touches a source system: drafts wait in Approvals (CLAUDE.md rule 10).
import { revalidatePath } from "next/cache";

import { activeMembership, getSession } from "../auth/session";
import { can, ROLES, type Capability } from "../permissions";
import {
  connectSource,
  createApproval,
  decideApproval,
  disconnectSource,
  inviteMember,
  markAskedFirstQuestion,
  reconnectSource,
  RETENTION_CHOICES,
  reviewDecision,
  setMemberRole,
  testSource,
  triggerSync,
  setRetention,
  StoreError,
  tenantView,
} from "./store";
import type { Role, Source } from "./types";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

async function actor(cap: Capability) {
  const session = await getSession();
  if (!session) throw new StoreError("your session has expired — sign in again");
  const m = activeMembership(session);
  if (!can(m.role, cap)) throw new StoreError("your role does not allow this");
  return { tenantId: m.tenantId, slug: m.slug, name: session.user.name, role: m.role, userId: session.user.id };
}

async function run(fn: () => Promise<string | undefined> | string | undefined, paths: string[]): Promise<ActionResult> {
  try {
    const message = await fn();
    for (const p of paths) revalidatePath(p);
    return { ok: true, message };
  } catch (e) {
    if (e instanceof StoreError) return { ok: false, error: e.message };
    throw e;
  }
}

// ---------------------------------------------------------------- decisions
export async function reviewDecisionAction(
  decisionId: string,
  action: "confirm" | "reject" | "edit",
  input: { title?: string; description?: string; note?: string } = {},
): Promise<ActionResult> {
  return run(async () => {
    const a = await actor("decisions.review");
    if (a.role === "member") {
      // Members may review only decisions on projects they lead.
      const v = tenantView(a.tenantId, a.slug);
      const d = v.data.decisions.find((x) => x.decisionId === decisionId);
      const project = d && v.data.projects.find((p) => p.projectId === d.projectId);
      const lead = project && v.data.people.find((p) => p.personId === project.leadId);
      if (!lead || lead.name !== a.name) throw new StoreError("only the project lead or a partner can review this decision");
    }
    const d = reviewDecision(a.tenantId, a.slug, a.name, decisionId, action, input);
    return action === "reject" ? `Rejected “${d.title}”.` : `Confirmed “${d.title}”.`;
  }, ["/decisions", "/projects", "/executive"]);
}

// ---------------------------------------------------------------- approvals
export async function requestApprovalAction(input: {
  title: string;
  body: string;
  kind: "draft_message" | "create_task";
  reason: string;
  evidenceIds: string[];
  projectId?: string;
}): Promise<ActionResult> {
  return run(async () => {
    const a = await actor("ask");
    const v = tenantView(a.tenantId, a.slug);
    const known = new Set(v.data.evidence.map((e) => e.id));
    const approval = createApproval(a.tenantId, a.slug, a.name, {
      ...input,
      // Only evidence that belongs to this tenant can be attached.
      evidenceIds: input.evidenceIds.filter((id) => known.has(id)).slice(0, 20),
      projectId: input.projectId && v.data.projects.some((p) => p.projectId === input.projectId) ? input.projectId : undefined,
    });
    return approval.approvalId;
  }, ["/approvals", "/executive"]);
}

export async function decideApprovalAction(
  approvalId: string,
  decision: "approve" | "reject",
  note: string,
  editedBody?: string,
): Promise<ActionResult> {
  return run(async () => {
    const a = await actor("approvals.decide");
    const ap = decideApproval(a.tenantId, a.slug, a.name, approvalId, decision, note, editedBody);
    return decision === "approve"
      ? `Approved “${ap.title}”. In development nothing is sent; production hands it to the approved action.`
      : `Rejected “${ap.title}”.`;
  }, ["/approvals", "/executive"]);
}

// ---------------------------------------------------------------- members
export async function changeRoleAction(userId: string, role: string): Promise<ActionResult> {
  return run(async () => {
    const a = await actor("members.manage");
    if (!(ROLES as string[]).includes(role)) throw new StoreError("unknown role");
    const m = setMemberRole(a.tenantId, a.slug, a.name, userId, role as Role);
    return `${m.email} is now ${role}.`;
  }, ["/settings/members"]);
}

export async function inviteMemberAction(email: string, role: string): Promise<ActionResult> {
  return run(async () => {
    const a = await actor("members.manage");
    if (!(ROLES as string[]).includes(role) || role === "owner") throw new StoreError("choose admin, member, viewer or guest");
    const m = inviteMember(a.tenantId, a.slug, a.name, email, role as Role);
    return `Invited ${m.email}.`;
  }, ["/settings/members"]);
}

// ---------------------------------------------------------------- sources
const CONNECTORS: Source["connectorType"][] = ["gmail", "drive", "sheets", "whatsapp", "file_drop", "calendar"];

export async function connectSourceAction(type: string, account: string): Promise<ActionResult> {
  return run(async () => {
    const a = await actor("sources.manage");
    if (!(CONNECTORS as string[]).includes(type)) throw new StoreError("unknown connector");
    const s = connectSource(a.tenantId, a.slug, a.name, type as Source["connectorType"], account);
    return `${s.displayName} connected. The first sync has started.`;
  }, ["/settings/sources", "/ask", "/apps"]);
}

export async function disconnectSourceAction(sourceId: string): Promise<ActionResult> {
  return run(async () => {
    const a = await actor("sources.manage");
    disconnectSource(a.tenantId, a.slug, a.name, sourceId);
    return "Source disconnected. Its items stop syncing; nothing already indexed is deleted until you ask.";
  }, ["/settings/sources", "/apps"]);
}

export async function reconnectSourceAction(sourceId: string): Promise<ActionResult> {
  return run(async () => {
    const a = await actor("sources.manage");
    const s = reconnectSource(a.tenantId, a.slug, a.name, sourceId);
    return `${s.displayName} reconnected.`;
  }, ["/settings/sources", "/executive", "/apps"]);
}

export async function syncNowAction(sourceId: string): Promise<ActionResult> {
  return run(async () => {
    const a = await actor("sources.manage");
    const s = triggerSync(a.tenantId, a.slug, a.name, sourceId);
    return `${s.displayName}: sync started.`;
  }, ["/settings/sources", "/ask"]);
}

export async function setRetentionAction(days: number): Promise<ActionResult> {
  return run(async () => {
    const a = await actor("security.manage");
    if (!(RETENTION_CHOICES as readonly number[]).includes(days)) throw new StoreError("choose a retention period from 90 days to 7 years");
    setRetention(a.tenantId, a.slug, a.name, days);
    return "Retention policy saved. The change is in the audit log.";
  }, ["/settings/security"]);
}

export async function testConnectionAction(sourceId: string): Promise<ActionResult> {
  try {
    const a = await actor("sources.manage");
    const r = testSource(a.tenantId, a.slug, a.name, sourceId);
    return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
  } catch (e) {
    if (e instanceof StoreError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function markAskedAction(): Promise<void> {
  const session = await getSession();
  if (!session) return;
  const m = activeMembership(session);
  markAskedFirstQuestion(m.tenantId, m.slug);
}
