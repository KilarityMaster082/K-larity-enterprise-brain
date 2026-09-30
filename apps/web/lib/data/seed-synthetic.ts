// Owner task: EB-23 Web UI shell — DEMO DATA for the synthetic canary tenant (development only).
// Every visible string carries the canary token so cross-tenant tests can assert it never appears in
// another workspace. The tenant starts with no sources, which is how onboarding is demonstrated; its data
// becomes visible only after a source has been connected and its (simulated) first sync has finished.
import type { Evidence } from "../contracts";
import { EMPTY_WORKSPACE } from "./empty";
import type { TenantDataset } from "./types";

export const CANARY = "CANARY-7f3e";

const excerpt = `${CANARY} canary ledger row: amount ₹4,56,789 for the canary build.`;
const quote = "amount ₹4,56,789";
const evidence: Evidence[] = [
  {
    id: "ev-canary-1",
    sourceType: "document",
    title: `${CANARY} canary document`,
    excerpt,
    highlight: { start: excerpt.indexOf(quote), end: excerpt.indexOf(quote) + quote.length },
    project: `${CANARY} Canary build`,
    occurredAt: "2026-09-29T10:00:00+05:30",
  },
];

export const SYNTHETIC_DATA: TenantDataset = {
  people: [{ personId: "p-canary", name: `${CANARY} tester`, org: "Synthetic", kind: "staff" }],
  projects: [
    {
      projectId: "canary-build",
      name: `${CANARY} Canary build`,
      code: "CAN",
      client: `${CANARY} client`,
      location: "Nowhere",
      description: `Synthetic project used only to detect cross-tenant leaks (${CANARY}).`,
      status: "active",
      stages: ["Start", "Middle", "End"],
      currentStage: 1,
      budget: 1000000,
      leadId: "p-canary",
      peopleIds: ["p-canary"],
      startedOn: "2026-09-01",
      dueOn: "2026-12-31",
    },
  ],
  budgetLines: [{ projectId: "canary-build", package: `${CANARY} package`, budget: 1000000 }],
  txns: [
    {
      txnId: "can-1",
      projectId: "canary-build",
      txnType: "invoice",
      txnRef: `${CANARY}-INV-1`,
      amount: 456789,
      direction: "payable",
      package: `${CANARY} package`,
      status: "pending",
      counterparty: `${CANARY} vendor`,
      txnDate: "2026-09-29",
      dueDate: "2026-10-29",
      evidenceId: "ev-canary-1",
    },
  ],
  events: [
    {
      eventId: "e-can-1",
      projectId: "canary-build",
      eventType: "invoice",
      occurredAt: "2026-09-29T10:00:00+05:30",
      title: `${CANARY} invoice received`,
      evidenceId: "ev-canary-1",
    },
  ],
  documents: [
    {
      documentId: "d-can-1",
      projectId: "canary-build",
      title: `${CANARY} canary document`,
      docType: "report",
      isLatest: true,
      source: "file_drop",
      updatedAt: "2026-09-29T10:00:00+05:30",
      sizeBytes: 1024,
      summary: `Canary content (${CANARY}).`,
      facts: [CANARY],
      evidenceId: "ev-canary-1",
    },
  ],
  decisions: [
    {
      decisionId: "dec-can-1",
      projectId: "canary-build",
      title: `${CANARY} canary decision`,
      description: `Synthetic draft decision (${CANARY}).`,
      status: "proposed",
      alternatives: [],
      evidenceIds: ["ev-canary-1"],
      confidence: 0.5,
    },
  ],
  approvals: [],
  sources: [],
  members: [
    { userId: "dev-user", name: "Demo user", email: "demo.user@example.com", role: "owner", status: "active" },
    { userId: "u-canary", name: `${CANARY} member`, email: "canary@example.com", role: "member", status: "active" },
  ],
  audit: [],
  evidence,
  // One row per workspace screen, each carrying the canary token, so a leak across tenants is caught by a string search.
  workspace: {
    ...EMPTY_WORKSPACE,
    mail: [
      {
        threadId: "t-canary-1",
        projectId: "canary-build",
        subject: `${CANARY} canary thread`,
        fromName: `${CANARY} sender`,
        fromOrg: `${CANARY} org`,
        category: "General",
        folder: "inbox",
        starred: false,
        unread: true,
        lastAt: "2026-09-29T10:00:00+05:30",
        messages: [{ messageId: "m-canary-1", fromName: `${CANARY} sender`, fromOrg: `${CANARY} org`, at: "2026-09-29T10:00:00+05:30", body: `Canary message body ${CANARY}.` }],
        attachments: [],
        extraction: { decisions: [], commitments: [], variations: [] },
        evidenceId: "ev-canary-1",
      },
    ],
    todos: [{ todoId: "td-canary-1", text: `${CANARY} canary todo`, projectId: "canary-build", assignee: `${CANARY} member`, done: false, source: { kind: "email", label: `${CANARY} thread`, evidenceId: "ev-canary-1" } }],
    spaces: [
      { spaceId: "sp-canary", name: "canary-space", topic: `${CANARY} canary topic`, members: [`${CANARY} member`], unread: 0, pinnedDocumentIds: [], agentRuns: 0, messages: [{ messageId: "sm-canary-1", author: `${CANARY} member`, at: "2026-09-29T10:00:00+05:30", text: `Canary chat ${CANARY}` }] },
    ],
  },
};
