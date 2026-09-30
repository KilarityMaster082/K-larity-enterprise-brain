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
  createFolder,
  deleteEntry,
  endMeeting,
  postSpaceMessage,
  reactToMessage,
  registerUploads,
  renameEntry,
  sendThreadDecisionToLog,
  setAppScopes,
  setTodoDone,
  toggleStar,
  decideApproval,
  disconnectSource,
  inviteMember,
  markAskedFirstQuestion,
  markThreadRead,
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

// ---------------------------------------------------------------- communications
export async function sendToDecisionLogAction(threadId: string, index: number): Promise<ActionResult> {
  return run(async () => {
    const a = await actor("decisions.view");
    const v = tenantView(a.tenantId, a.slug);
    if (v.data.workspace.mail.find((t) => t.threadId === threadId)?.financial && !can(a.role, "finance.view")) throw new StoreError("your role cannot open this thread");
    const d = sendThreadDecisionToLog(a.tenantId, a.slug, a.name, threadId, index);
    return `Sent to the decision queue as a draft. Open it in Decisions to confirm: ${d.decisionId}`;
  }, ["/communications", "/decisions", "/executive"]);
}

/** Composer "Send": creates an approval with the drafted reply. Nothing is sent until someone approves it (rule 10). */
export async function submitReplyAction(threadId: string, mode: "reply" | "reply_all" | "forward", body: string): Promise<ActionResult> {
  return run(async () => {
    const a = await actor("comms.view");
    const v = tenantView(a.tenantId, a.slug);
    const t = v.data.workspace.mail.find((x) => x.threadId === threadId);
    if (!t || (t.financial && !can(a.role, "finance.view"))) throw new StoreError("thread not found");
    const text = body.trim();
    if (!text) throw new StoreError("write the message first");
    const verb = mode === "forward" ? "Forward" : mode === "reply_all" ? "Reply all" : "Reply";
    const approval = createApproval(a.tenantId, a.slug, a.name, {
      kind: "draft_message",
      title: `${verb}: ${t.subject}`.slice(0, 200),
      body: text.slice(0, 4000),
      reason: `Drafted in the email composer by ${a.name}.`,
      evidenceIds: t.evidenceId ? [t.evidenceId] : [],
      projectId: t.projectId,
    });
    return approval.approvalId;
  }, ["/approvals", "/executive", "/communications"]);
}

export async function toggleStarAction(threadId: string): Promise<ActionResult> {
  return run(async () => {
    const a = await actor("comms.view");
    return toggleStar(a.tenantId, a.slug, threadId) ? "Starred." : "Unstarred.";
  }, ["/communications"]);
}

// ---------------------------------------------------------------- todos, spaces, meetings
export async function setTodoDoneAction(todoId: string, done: boolean): Promise<ActionResult> {
  return run(async () => {
    const a = await actor("todos.view");
    if (a.role === "viewer") throw new StoreError("viewers cannot change todos");
    const t = setTodoDone(a.tenantId, a.slug, a.name, todoId, done);
    return done ? `Done: ${t.text}` : `Reopened: ${t.text}`;
  }, ["/todos", "/meetings"]);
}

export async function postSpaceMessageAction(spaceId: string, text: string, documentId?: string): Promise<ActionResult> {
  return run(async () => {
    const a = await actor("spaces.view");
    if (a.role === "viewer") throw new StoreError("viewers can read spaces but not post");
    postSpaceMessage(a.tenantId, a.slug, a.name, spaceId, text, documentId);
    return "Posted.";
  }, [`/spaces/${spaceId}`, "/spaces", "/activity"]);
}

export async function reactAction(spaceId: string, messageId: string, emoji: string): Promise<ActionResult> {
  return run(async () => {
    const a = await actor("spaces.view");
    if (a.role === "viewer") throw new StoreError("viewers can read spaces but not react");
    reactToMessage(a.tenantId, a.slug, a.name, spaceId, messageId, emoji);
    return undefined;
  }, [`/spaces/${spaceId}`]);
}

export async function endMeetingAction(meetingId: string): Promise<ActionResult> {
  return run(async () => {
    const a = await actor("meetings.view");
    if (a.role === "viewer") throw new StoreError("viewers cannot end a meeting");
    const r = endMeeting(a.tenantId, a.slug, a.name, meetingId);
    return `Meeting ended. ${r.todos.length} action item${r.todos.length === 1 ? "" : "s"} added to Todos.`;
  }, ["/meetings", "/todos", "/activity"]);
}

// ---------------------------------------------------------------- knowledge vault
export async function uploadFilesAction(folderId: string, files: { name: string; bytes: number }[]): Promise<ActionResult> {
  return run(async () => {
    const a = await actor("knowledge.view");
    if (a.role === "viewer") throw new StoreError("viewers cannot upload");
    const clean = files.slice(0, 20).map((f) => ({ name: String(f.name), bytes: Math.max(0, Number(f.bytes) || 0) }));
    const added = registerUploads(a.tenantId, a.slug, a.name, folderId, clean);
    return `${added.length} file${added.length === 1 ? "" : "s"} queued for parsing. In development the bytes are not stored; production writes them to the tenant bucket.`;
  }, ["/knowledge/files", "/knowledge", "/activity"]);
}

export async function createFolderAction(parentId: string | undefined, name: string): Promise<ActionResult> {
  return run(async () => {
    const a = await actor("knowledge.view");
    if (a.role === "viewer") throw new StoreError("viewers cannot create folders");
    createFolder(a.tenantId, a.slug, a.name, parentId, name);
    return "Folder created.";
  }, ["/knowledge/files"]);
}

export async function renameEntryAction(kind: "folder" | "file", id: string, name: string): Promise<ActionResult> {
  return run(async () => {
    const a = await actor("knowledge.view");
    if (a.role === "viewer") throw new StoreError("viewers cannot rename");
    renameEntry(a.tenantId, a.slug, a.name, kind, id, name);
    return "Renamed.";
  }, ["/knowledge/files"]);
}

export async function deleteEntryAction(kind: "folder" | "file", id: string): Promise<ActionResult> {
  return run(async () => {
    const a = await actor("knowledge.view");
    if (a.role === "viewer" || a.role === "member") throw new StoreError("only partners and owners can delete from the vault");
    deleteEntry(a.tenantId, a.slug, a.name, kind, id);
    return "Deleted from the vault.";
  }, ["/knowledge/files", "/knowledge"]);
}

// ---------------------------------------------------------------- apps
export async function setAppScopesAction(appId: string, disabledScopes: string[]): Promise<ActionResult> {
  return run(async () => {
    const a = await actor("apps.manage");
    setAppScopes(a.tenantId, a.slug, a.name, appId, disabledScopes);
    return "Sync scopes saved.";
  }, [`/apps/${appId}`, "/apps"]);
}

export async function markThreadReadAction(threadId: string): Promise<void> {
  const session = await getSession();
  if (!session) return;
  const m = activeMembership(session);
  if (!can(m.role, "comms.view")) return;
  markThreadRead(m.tenantId, m.slug, threadId);
  revalidatePath("/communications");
}
