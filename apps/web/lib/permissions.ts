// Owner task: EB-23 Web UI shell — what each role may see and do. Roles are the DB's users.role values
// (db/migrations/0001_initial.sql). "admin" is shown as "Partner (admin)". The server checks these on every
// page and action; hiding a nav item is only a convenience. Source-level ACLs (EB-42) apply on top.
import type { Role } from "./data/types";

export type Capability =
  | "ask"
  | "projects.view"
  | "finance.view"
  | "executive.view"
  | "decisions.view"
  | "decisions.review"
  | "documents.view"
  | "approvals.view"
  | "approvals.decide"
  | "settings.view"
  | "sources.manage"
  | "members.manage";

const ALL: Capability[] = [
  "ask",
  "projects.view",
  "finance.view",
  "executive.view",
  "decisions.view",
  "decisions.review",
  "documents.view",
  "approvals.view",
  "approvals.decide",
  "settings.view",
  "sources.manage",
  "members.manage",
];

const MATRIX: Record<Role, readonly Capability[]> = {
  owner: ALL,
  admin: ALL.filter((c) => c !== "members.manage"),
  // Members review decisions only on projects they lead (checked in the action).
  member: ["ask", "projects.view", "decisions.view", "decisions.review", "documents.view", "approvals.view"],
  viewer: ["ask", "projects.view", "decisions.view", "documents.view", "approvals.view"],
  guest: ["ask", "documents.view"],
};

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Partner (admin)",
  member: "Member",
  viewer: "Viewer",
  guest: "Guest",
};

export const ROLES: Role[] = ["owner", "admin", "member", "viewer", "guest"];

export function can(role: Role, cap: Capability): boolean {
  return MATRIX[role].includes(cap);
}
