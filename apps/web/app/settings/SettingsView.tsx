"use client";
// Owner task: EB-93 Settings: connected sources and members — tabs for sources, members & roles, audit, data.
import {
  Badge,
  DataTable,
  EmptyState,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatRelative,
  Icon,
  Modal,
  TabPanel,
  Tabs,
  useToast,
  type Column,
  type IconName,
  type Tone,
} from "@klarity/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import {
  changeRoleAction,
  connectSourceAction,
  disconnectSourceAction,
  inviteMemberAction,
  reconnectSourceAction,
  type ActionResult,
} from "@/lib/data/actions";
import type { AuditEvent, Member, Role, Source, SourceHealth } from "@/lib/data/types";
import { ROLE_LABEL, ROLES } from "@/lib/permissions";

const HEALTH: Record<SourceHealth, { label: string; tone: Tone }> = {
  ok: { label: "Healthy", tone: "ok" },
  degraded: { label: "Some errors", tone: "warn" },
  failing: { label: "Failing", tone: "danger" },
  auth_error: { label: "Needs reconnect", tone: "danger" },
  syncing: { label: "First sync running", tone: "info" },
  never_run: { label: "Not synced yet", tone: "neutral" },
};

const CONNECTORS: { type: Source["connectorType"]; label: string; icon: IconName; hint: string }[] = [
  { type: "gmail", label: "Gmail", icon: "mail", hint: "Mailbox address, e.g. partners@yourfirm.com" },
  { type: "drive", label: "Google Drive", icon: "documents", hint: "Shared drive or folder name" },
  { type: "sheets", label: "Google Sheets", icon: "sheet", hint: "Workbook name, e.g. Budget & billing 2026" },
  { type: "whatsapp", label: "WhatsApp export", icon: "chat", hint: "Group name of the exported chat" },
  { type: "file_drop", label: "File drop folder", icon: "download", hint: "Folder name" },
];

export function SettingsView({
  initialTab,
  sources,
  members,
  audit,
  syncProgress,
  canManageSources,
  canManageMembers,
  currentUserId,
}: {
  initialTab: string;
  sources: Source[];
  members: Member[];
  audit: AuditEvent[];
  syncProgress?: number;
  canManageSources: boolean;
  canManageMembers: boolean;
  currentUserId: string;
}) {
  const [tab, setTab] = useState(initialTab);
  const [connecting, setConnecting] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [busy, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  // While a first sync runs, refresh every 2 s so progress and completion show up without a reload.
  useEffect(() => {
    if (syncProgress === undefined) return;
    const t = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(t);
  }, [syncProgress, router]);

  function run(p: Promise<ActionResult>, after?: () => void) {
    start(async () => {
      const res = await p;
      if (res.ok) {
        toast(res.message ?? "Saved.");
        after?.();
      } else toast(res.error, "danger");
    });
  }

  const sourceCols: Column<Source>[] = [
    {
      key: "name",
      header: "Source",
      cell: (s) => (
        <span className="stack-sm" style={{ gap: 0 }}>
          <strong>{s.displayName}</strong>
          <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
            {s.account}
          </span>
        </span>
      ),
      sort: (s) => s.displayName,
      text: (s) => `${s.displayName} ${s.account}`,
    },
    {
      key: "health",
      header: "Health",
      cell: (s) => (
        <span className="stack-sm" style={{ gap: 4 }}>
          <Badge tone={HEALTH[s.health].tone}>{HEALTH[s.health].label}</Badge>
          {s.health === "syncing" && syncProgress !== undefined ? (
            <span className="muted" style={{ fontSize: "var(--fs-xs)" }} role="status">
              {Math.round(syncProgress * 100)}% of first sync
            </span>
          ) : null}
          {s.lastError ? (
            <span style={{ fontSize: "var(--fs-xs)", color: "var(--danger)" }}>{s.lastError}</span>
          ) : null}
        </span>
      ),
      sort: (s) => s.health,
    },
    {
      key: "last",
      header: "Last sync",
      cell: (s) => (s.lastSyncAt ? <time title={formatDateTime(s.lastSyncAt)}>{formatRelative(s.lastSyncAt)}</time> : "—"),
      sort: (s) => s.lastSyncAt ?? "",
    },
    { key: "items", header: "Items", numeric: true, cell: (s) => formatNumber(s.itemsSeen), sort: (s) => s.itemsSeen },
    { key: "err", header: "Errors (24 h)", numeric: true, cell: (s) => formatPercent(s.errorRate), sort: (s) => s.errorRate },
    {
      key: "act",
      header: "Actions",
      cell: (s) =>
        canManageSources ? (
          <span className="row">
            {s.health === "auth_error" ? (
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(reconnectSourceAction(s.sourceId))}>
                Reconnect
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={busy}
              onClick={() => {
                if (confirm(`Disconnect ${s.displayName} (${s.account})? It stops syncing.`)) run(disconnectSourceAction(s.sourceId));
              }}
            >
              Disconnect
            </button>
          </span>
        ) : (
          <span className="muted">—</span>
        ),
    },
  ];

  const memberCols: Column<Member>[] = [
    {
      key: "name",
      header: "Member",
      cell: (m) => (
        <span className="stack-sm" style={{ gap: 0 }}>
          <strong>
            {m.name}
            {m.userId === currentUserId ? " (you)" : ""}
          </strong>
          <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
            {m.email}
          </span>
        </span>
      ),
      sort: (m) => m.name,
      text: (m) => `${m.name} ${m.email} ${m.role}`,
    },
    {
      key: "role",
      header: "Role",
      cell: (m) =>
        canManageMembers ? (
          <select
            className="select"
            style={{ width: "auto", minHeight: 32 }}
            aria-label={`Role for ${m.email}`}
            value={m.role}
            disabled={busy}
            onChange={(e) => run(changeRoleAction(m.userId, e.target.value))}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        ) : (
          ROLE_LABEL[m.role]
        ),
      sort: (m) => ROLES.indexOf(m.role),
    },
    {
      key: "status",
      header: "Status",
      cell: (m) => <Badge tone={m.status === "active" ? "ok" : m.status === "invited" ? "info" : "neutral"}>{m.status}</Badge>,
      sort: (m) => m.status,
    },
    {
      key: "seen",
      header: "Last active",
      cell: (m) => (m.lastActiveAt ? <time title={formatDateTime(m.lastActiveAt)}>{formatRelative(m.lastActiveAt)}</time> : "—"),
      sort: (m) => m.lastActiveAt ?? "",
    },
  ];

  const auditCols: Column<AuditEvent>[] = [
    { key: "at", header: "When", cell: (a) => formatDateTime(a.at), sort: (a) => a.at },
    { key: "actor", header: "Who", cell: (a) => a.actor, sort: (a) => a.actor, text: (a) => `${a.actor} ${a.action} ${a.target} ${a.detail ?? ""}` },
    { key: "action", header: "Action", cell: (a) => <code>{a.action}</code>, sort: (a) => a.action },
    { key: "target", header: "On", cell: (a) => a.target },
    { key: "detail", header: "Detail", cell: (a) => a.detail ?? "" },
  ];

  return (
    <>
      <Tabs
        label="Settings"
        value={tab}
        onChange={(t) => {
          setTab(t);
          router.replace(`/settings?tab=${t}`, { scroll: false });
        }}
        tabs={[
          { id: "sources", label: "Sources", count: sources.length },
          { id: "members", label: "Members & roles", count: members.length },
          { id: "audit", label: "Audit log" },
          { id: "data", label: "Data" },
        ]}
      />

      <TabPanel id="sources" active={tab === "sources"}>
        <div className="stack">
          <div className="row-between">
            <p className="muted" style={{ fontSize: "var(--fs-sm)", maxWidth: "70ch" }}>
              The Brain reads only what these sources share, and only the people who can see an item at the source can see it here.
              Credentials are encrypted per workspace and never shown.
            </p>
            {canManageSources ? (
              <button type="button" className="btn btn-primary" onClick={() => setConnecting(true)}>
                <Icon name="plus" size={16} /> Connect a source
              </button>
            ) : null}
          </div>
          {sources.length ? (
            <DataTable rows={sources} columns={sourceCols} rowKey={(s) => s.sourceId} caption="Connected sources" initialSort={{ key: "health", dir: "asc" }} />
          ) : (
            <EmptyState icon="plug" title="No sources connected yet" action={canManageSources ? <button type="button" className="btn btn-primary" onClick={() => setConnecting(true)}>Connect your first source</button> : null}>
              <p>Connect Gmail, Google Drive, Sheets or a WhatsApp export. The first sync starts straight away.</p>
            </EmptyState>
          )}
        </div>
      </TabPanel>

      <TabPanel id="members" active={tab === "members"}>
        <div className="stack">
          <div className="row-between">
            <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>
              Owners manage members. Role changes are recorded in the audit log.
            </p>
            {canManageMembers ? (
              <button type="button" className="btn btn-primary" onClick={() => setInviting(true)}>
                <Icon name="plus" size={16} /> Invite
              </button>
            ) : null}
          </div>
          <DataTable rows={members} columns={memberCols} rowKey={(m) => m.userId} caption="Members and roles" searchPlaceholder="Filter members" />
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>What each role can do</summary>
            <ul className="list-bullets" style={{ marginTop: 8, fontSize: "var(--fs-sm)" }}>
              <li><strong>Owner</strong>: everything, including members and roles.</li>
              <li><strong>Partner (admin)</strong>: everything except managing members.</li>
              <li><strong>Member</strong>: Ask, projects, decisions (reviews drafts on projects they lead), documents, approvals (view).</li>
              <li><strong>Viewer</strong>: read-only Ask, projects, decisions, documents and approvals.</li>
              <li><strong>Guest</strong>: Ask and documents shared with them.</li>
            </ul>
          </details>
        </div>
      </TabPanel>

      <TabPanel id="audit" active={tab === "audit"}>
        <DataTable rows={audit} columns={auditCols} rowKey={(a) => a.id} caption="Audit log" initialSort={{ key: "at", dir: "desc" }} searchPlaceholder="Filter the audit log" empty="No audited actions yet." />
      </TabPanel>

      <TabPanel id="data" active={tab === "data"}>
        <div className="grid-2">
          <section className="card card-pad stack-sm">
            <h2 style={{ fontSize: "var(--fs-md)" }}>Where your data lives</h2>
            <p style={{ fontSize: "var(--fs-sm)", color: "var(--text-2)" }}>
              In India (Hyderabad region), encrypted with this workspace&apos;s own key. Other workspaces cannot read it.
            </p>
          </section>
          <section className="card card-pad stack-sm">
            <h2 style={{ fontSize: "var(--fs-md)" }}>Export or delete</h2>
            <p style={{ fontSize: "var(--fs-sm)", color: "var(--text-2)" }}>
              Full export and deletion with a signed certificate are handled by K!larity on request while self-service is built.
            </p>
          </section>
        </div>
      </TabPanel>

      <Modal open={connecting} onClose={() => setConnecting(false)} title="Connect a source">
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(connectSourceAction(String(f.get("type")), String(f.get("account"))), () => setConnecting(false));
          }}
        >
          <fieldset style={{ border: 0, padding: 0, margin: 0 }} className="stack-sm">
            <legend className="field" style={{ marginBottom: 6 }}>
              Source type
            </legend>
            {CONNECTORS.map((c, i) => (
              <label key={c.type} className="row" style={{ fontSize: "var(--fs-sm)" }}>
                <input type="radio" name="type" value={c.type} defaultChecked={i === 0} /> <Icon name={c.icon} size={16} /> {c.label}
                <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                  — {c.hint}
                </span>
              </label>
            ))}
          </fieldset>
          <label className="field">
            Account or folder
            <input name="account" className="input" required maxLength={120} placeholder="e.g. partners@yourfirm.com" />
          </label>
          <p className="note note-info">
            In development this simulates the Google sign-in and the first sync (about 12 seconds). Production opens the
            provider&apos;s consent screen; the token goes straight to the encrypted credential store.
          </p>
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Connect
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={inviting} onClose={() => setInviting(false)} title="Invite a member">
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(inviteMemberAction(String(f.get("email")), String(f.get("role"))), () => setInviting(false));
          }}
        >
          <label className="field">
            Email
            <input name="email" type="email" className="input" required autoComplete="off" />
          </label>
          <label className="field">
            Role
            <select name="role" className="select" defaultValue="member">
              {ROLES.filter((r) => r !== "owner").map((r: Role) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Send invitation
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
