"use client";
// Owner task: EB-93 Settings: connected sources and members — members table, role select, invite dialog.
import { Bento, BentoHead, DataTable, Modal, Pill, PillButton, formatDateTime, formatRelative, useToast, type Column } from "@klarity/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { changeRoleAction, inviteMemberAction, type ActionResult } from "@/lib/data/actions";
import type { Member, Role } from "@/lib/data/types";
import { ROLE_LABEL, ROLES } from "@/lib/permissions";

const ROLE_HELP: Record<Role, string> = {
  owner: "Everything, including members, roles, retention and security.",
  admin: "Everything except members, roles, retention and security.",
  member: "Ask, projects, decisions (reviews drafts on projects they lead), documents, communications, meetings, todos, spaces.",
  viewer: "Read-only: the same screens as a member, without reviewing decisions.",
  guest: "Ask and the documents shared with them.",
};

export function MembersView({ members, currentUserId, fgaStore }: { members: Member[]; currentUserId: string; fgaStore: string }) {
  const [inviting, setInviting] = useState(false);
  const [busy, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  function run(p: Promise<ActionResult>, after?: () => void) {
    start(async () => {
      const res = await p;
      if (res.ok) {
        toast(res.message ?? "Saved.");
        after?.();
        router.refresh();
      } else toast(res.error, "danger");
    });
  }

  const cols: Column<Member>[] = [
    {
      key: "name",
      header: "Member",
      cell: (m) => (
        <span>
          <strong>
            {m.name}
            {m.userId === currentUserId ? " (you)" : ""}
          </strong>
          <br />
          <span className="eb-dim" style={{ fontSize: "var(--eb-t-xs)" }}>{m.email}</span>
        </span>
      ),
      sort: (m) => m.name,
      text: (m) => `${m.name} ${m.email} ${m.role}`,
    },
    {
      key: "role",
      header: "Role",
      cell: (m) => (
        <select className="eb-input" style={{ width: "auto", minHeight: 28, padding: "3px 10px" }} aria-label={`Role for ${m.email}`} value={m.role} disabled={busy} onChange={(e) => run(changeRoleAction(m.userId, e.target.value))}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      ),
      sort: (m) => ROLES.indexOf(m.role),
    },
    { key: "status", header: "Status", cell: (m) => <Pill tone={m.status === "active" ? "green" : m.status === "invited" ? "sky" : "glass"} size="sm">{m.status}</Pill>, sort: (m) => m.status },
    { key: "seen", header: "Last active", cell: (m) => (m.lastActiveAt ? <time dateTime={m.lastActiveAt} title={`${formatDateTime(m.lastActiveAt)} IST`}>{formatRelative(m.lastActiveAt)}</time> : "—"), sort: (m) => m.lastActiveAt ?? "" },
  ];

  return (
    <div className="eb-stack">
      <Bento tone="strong" aria-label="Members">
        <BentoHead
          title="Team directory"
          eyebrow
          aside={
            <PillButton tone="black" onClick={() => setInviting(true)}>
              Invite a member
            </PillButton>
          }
        />
        <div style={{ marginTop: 8 }}>
          <DataTable rows={members} columns={cols} rowKey={(m) => m.userId} caption="Members and roles" searchPlaceholder="Filter members" />
        </div>
      </Bento>
      <div className="eb-grid" style={{ ["--cols" as string]: "1.4fr 1fr" }}>
        <Bento tone="lavender" aria-label="What each role can do">
          <BentoHead title="What each role can do" eyebrow />
          <dl className="eb-stack tight" style={{ margin: "8px 0 0" }}>
            {ROLES.map((r) => (
              <div key={r}>
                <dt className="eb-h">{ROLE_LABEL[r]}</dt>
                <dd style={{ margin: 0 }} className="eb-body">{ROLE_HELP[r]}</dd>
              </div>
            ))}
          </dl>
        </Bento>
        <Bento tone="sky" aria-label="Permission sync">
          <BentoHead title="Permission sync" eyebrow />
          <p className="eb-body" style={{ marginTop: 8 }}>
            Roles are recorded in the audit log on every change. Production also writes them to this workspace&apos;s OpenFGA store <span className="eb-mono">{fgaStore}</span> (packages/permissions), so
            Ask Brain checks the same roles before it retrieves anything.
          </p>
        </Bento>
      </div>

      <Modal open={inviting} onClose={() => setInviting(false)} title="Invite a member">
        <form
          className="eb-stack"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(inviteMemberAction(String(f.get("email")), String(f.get("role"))), () => setInviting(false));
          }}
        >
          <label className="eb-label">
            Email
            <input name="email" type="email" className="eb-input" required autoComplete="off" />
          </label>
          <label className="eb-label">
            Role
            <select name="role" className="eb-input" defaultValue="member">
              {ROLES.filter((r) => r !== "owner").map((r: Role) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
          <div>
            <PillButton type="submit" tone="black" size="lg" disabled={busy}>Send invitation</PillButton>
          </div>
        </form>
      </Modal>
    </div>
  );
}
