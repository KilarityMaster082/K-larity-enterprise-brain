// Owner task: EB-23 Web UI shell — DEMO DATA, second half of the Studio 8 workspace seed: files the viewers can open
// (screens 30–37), background agent runs (24–25), spaces (26–28), the app catalog (38–39), Ask history (40) and the
// retention policy (45). Development only. File contents are what the parsers would return for each document.
import type { Evidence } from "../contracts";
import { ev } from "./seed-util";
import type { AgentJob, AgentRun, AppDef, DocumentItem, FileContent, HistoryItem, RetentionPolicy, Space, WorkspaceDataset } from "./types";

// ---------------------------------------------------------------- documents the viewers open
const doc = (d: Omit<DocumentItem, "evidenceId" | "isLatest"> & { isLatest?: boolean }): DocumentItem => ({ isLatest: true, evidenceId: `ev-${d.documentId}`, ...d });

export const WORKSPACE_DOCUMENTS: DocumentItem[] = [
  doc({ documentId: "d-phx-rfi27", projectId: "phoenix", title: "RFI-27 revised steel section at grid C–D", docType: "report", source: "gmail", updatedAt: "2026-09-29T16:12:00+05:30", sizeBytes: 210_000, summary: "Primary beams change to ISMB 450; 14.2 tonnes extra at ₹92,000 per tonne.", facts: ["ISMB 450", "14.2 tonnes", "₹92,000 per tonne"], fileName: "RFI-27.pdf" }),
  doc({ documentId: "d-phx-ismb450", projectId: "phoenix", title: "ISMB 450 calculation", docType: "report", source: "gmail", updatedAt: "2026-09-29T16:12:00+05:30", sizeBytes: 84_000, summary: "Bending moment check for the revised primary beams.", facts: ["Span 6 m", "ISMB 450"], fileName: "ISMB450-calc.xlsx" }),
  doc({ documentId: "d-phx-boq", projectId: "phoenix", title: "Phoenix BOQ v7", docType: "quotation", revision: "v7", source: "drive", updatedAt: "2026-09-22T10:00:00+05:30", sizeBytes: 420_000, summary: "Bill of quantities for steel, facade and civil packages.", facts: ["Steel ISMB 450: 14.2 t × ₹92,000"], fileName: "Phoenix_BOQ_v7.xlsx" }),
  doc({ documentId: "d-phx-skyline-contract", projectId: "phoenix", title: "Skyline Facades contract", docType: "contract", source: "drive", updatedAt: "2026-08-12T10:00:00+05:30", sizeBytes: 360_000, summary: "Facade package contract with Skyline Facades, signed 12 August.", facts: ["Signed 12 Aug", "Payment terms 30 days"], signed: true, amount: 2400000, fileName: "Skyline_Facades_contract.docx" }),
  doc({ documentId: "d-phx-deck", projectId: "phoenix", title: "Client progress deck — September", docType: "report", source: "drive", updatedAt: "2026-09-25T10:00:00+05:30", sizeBytes: 5_800_000, summary: "Monthly progress deck shared with the Phoenix client.", facts: ["Stage 4 of 5"], fileName: "Phoenix_progress_Sep.pptx" }),
  doc({ documentId: "d-phx-photo", projectId: "phoenix", title: "Level 2 slab shuttering", docType: "report", source: "whatsapp", updatedAt: "2026-09-29T09:20:00+05:30", sizeBytes: 3_400_000, summary: "Site photo of the level 2 slab shuttering before the pour.", facts: ["Level 2 slab", "29 Sep"], fileName: "level2_slab_shuttering.jpg" }),
  doc({ documentId: "d-phx-drone", projectId: "phoenix", title: "Drone flythrough — 28 Sep", docType: "report", source: "drive", updatedAt: "2026-09-28T16:00:00+05:30", sizeBytes: 88_000_000, summary: "Drone flythrough of the structure for the client update.", facts: ["2 min 10 s"], fileName: "drone_flythrough_28sep.mp4" }),
  doc({ documentId: "d-phx-voice", projectId: "phoenix", title: "Site engineer voice note — steel bay C–D", docType: "minutes", source: "whatsapp", updatedAt: "2026-09-29T08:10:00+05:30", sizeBytes: 640_000, summary: "Voice note about the steel erection at bay C–D.", facts: ["Bay C–D"], fileName: "voice_note_bay_cd.m4a" }),
  doc({ documentId: "d-ops-labels", projectId: "", title: "Gmail label mapping", docType: "report", source: "file_drop", updatedAt: "2026-09-26T10:00:00+05:30", sizeBytes: 2_100, summary: "Maps Gmail labels to projects for the Partners mailbox.", facts: ["Label → project"], fileName: "gmail-label-mapping.json" }),
];

const PROJECT_NAMES: Record<string, string> = { phoenix: "Project Phoenix", marigold: "Marigold Clinic", lotus: "Lotus Villa", banyan: "Banyan Office fit-out" };

export const WORKSPACE_DOC_EVIDENCE: Evidence[] = WORKSPACE_DOCUMENTS.map((d) =>
  ev(d.evidenceId, d.source === "gmail" ? "email" : d.source === "whatsapp" ? "whatsapp" : d.source === "sheets" ? "sheet" : "document", d.title, `${d.title}. ${d.summary}`, d.summary, {
    project: PROJECT_NAMES[d.projectId] ?? "Workspace",
    occurredAt: d.updatedAt,
  }),
);

// ---------------------------------------------------------------- file contents
export const STUDIO8_CONTENTS: Record<string, FileContent> = {
  "d-phx-boq": {
    kind: "xlsx",
    sheets: [
      {
        name: "BOQ",
        columns: ["Item", "Description", "Unit", "Qty", "Rate (₹)", "Amount (₹)"],
        freezeRows: 1,
        freezeCols: 1,
        currencyColumns: [4, 5],
        rows: [
          ["ST-101", "Structural steel ISMB 450, supplied and fixed", "tonne", 14.2, 92000, { f: "=D2*E2" }],
          ["ST-102", "Structural steel ISMB 600, supplied and fixed", "tonne", 9.6, 94500, { f: "=D3*E3" }],
          ["FA-210", "HPL cladding 8 mm on aluminium sub-frame", "sq.m", 310, 6800, { f: "=D4*E4" }],
          ["CV-030", "M30 concrete, pumped", "cu.m", 120, 7600, { f: "=D5*E5" }],
          ["", "Total", "", "", "", { f: "=SUM(F2:F5)" }],
        ],
      },
      { name: "Notes", columns: ["Note"], freezeRows: 1, freezeCols: 0, rows: [["Rates as approved in v7; ISMB 450 rate per RFI-27."], ["Quantities are net; wastage carried separately."]] },
    ],
  },
  "d-phx-ismb450": {
    kind: "xlsx",
    sheets: [
      {
        name: "Load",
        columns: ["Bay", "Span (m)", "Load (kN/m)", "Moment (kNm)"],
        freezeRows: 1,
        freezeCols: 1,
        rows: [
          ["C–D", 6, 48, { f: "=C2*B2*B2/8" }],
          ["D–E", 6, 44, { f: "=C3*B3*B3/8" }],
          ["Max", "", "", { f: "=SUM(D2:D3)" }],
        ],
      },
    ],
  },
  "d-phx-rfi27": {
    kind: "pdf",
    pages: [
      { n: 1, heading: "RFI-27 · Revised steel section at grid C–D", lines: ["To: Studio 8 Hats · From: Vertex Structures", "Date: 29 September 2026", "Following the revised loading, the primary beams change to ISMB 450.", "Supply of the additional 14.2 tonnes will be billed at ₹92,000 per tonne and needs your confirmation before fabrication starts.", "Please reply by Friday."], marks: [{ line: 3, start: 0, end: 72 }] },
      { n: 2, heading: "Attachments", lines: ["ISMB450-calc.xlsx — bending moment check", "Drawing PHX-STR-204 Rev C — for reference"] },
    ],
  },
  "d-phx-skyline-contract": {
    kind: "docx",
    blocks: [
      { type: "h1", text: "Facade package contract" },
      { type: "p", text: "Between Studio 8 Hats and Skyline Facades, for the supply and installation of the ventilated HPL facade at Project Phoenix." },
      { type: "h2", text: "1. Scope" },
      { type: "li", text: "8 mm HPL panels on an aluminium sub-frame, open-joint ventilated system." },
      { type: "li", text: "Fixing system and scaffolding for the front elevation." },
      { type: "h2", text: "2. Payment" },
      { type: "p", text: "Invoices are payable within 30 days of receipt. Variations are valid only when signed by both parties." },
      { type: "h2", text: "3. Signatures" },
      { type: "p", text: "Signed on 12 August 2026 by both parties." },
    ],
  },
  "d-phx-deck": {
    kind: "pptx",
    slides: [
      { title: "Phoenix · September progress", bullets: ["Stage 4 of 5: Execution", "Level 2 slab shuttering complete", "Steel delivery recovering"], notes: "Keep the tone factual: steel delay is the main risk." },
      { title: "Facade", bullets: ["HPL ventilated facade approved", "VO-07 awaiting signature", "Double low-E glazing under review"], notes: "Do not quote the variation amount before the client signs." },
      { title: "Next four weeks", bullets: ["Release ISMB 450 fabrication for the C–D bay", "Close the level 2 MEP first fix", "Curtain wall mock-up"], notes: "Dates depend on the steel recovery plan." },
    ],
  },
  "d-phx-photo": { kind: "image", caption: "Level 2 slab shuttering before the pour, looking north-east.", takenAt: "2026-09-29T09:20:00+05:30", location: "Jubilee Hills, Hyderabad", width: 4032, height: 3024, tags: ["Level 2", "Shuttering", "Pre-pour check"] },
  "d-phx-drone": {
    kind: "video",
    durationSec: 130,
    chapters: [
      { at: 0, label: "Approach from the east" },
      { at: 35, label: "Steel frame at level 2" },
      { at: 80, label: "Front elevation" },
    ],
    captions: [
      { at: 2, text: "Approaching the site from the east gate." },
      { at: 38, text: "The steel frame for the transfer beam is visible at level 2." },
      { at: 83, text: "Front elevation, before the facade sub-frame." },
    ],
  },
  "d-phx-voice": {
    kind: "audio",
    durationSec: 48,
    from: "Site engineer",
    transcript: [
      { at: 0, text: "Steel erection at bay C–D started this morning." },
      { at: 14, text: "We are waiting for written confirmation on the ISMB 450 section before releasing the next bay." },
      { at: 31, text: "Crane is booked until Friday, so we have a window if the confirmation arrives tomorrow." },
    ],
  },
  "d-ops-labels": {
    kind: "code",
    language: "json",
    path: "config/gmail-label-mapping.json",
    before: `{
  "labels": {
    "Phoenix": "phoenix",
    "Marigold": "marigold",
    "Lotus": "lotus"
  }
}
`,
    after: `{
  "labels": {
    "Phoenix": "phoenix",
    "Marigold": "marigold",
    "Lotus": "lotus",
    "Banyan": "banyan"
  }
}
`,
  },
};

// ---------------------------------------------------------------- background agents
const step = (at: string, tool: string, detail: string, tokens: number, error?: string) => ({ at, tool, detail, tokens, error });
const run = (runId: string, jobId: string, startedAt: string, status: AgentRun["status"], attempt: number, steps: AgentRun["steps"]): AgentRun => ({ runId, jobId, startedAt, status, attempt, steps });

const JOBS: AgentJob[] = [
  {
    jobId: "job-gmail", name: "Gmail incremental sync", description: "Reads new mail for connected mailboxes from the last historyId.", schedule: "every 5 min", status: "running", lastRunAt: "2026-09-30T11:55:00+05:30", durationSec: 14, tokensToday: 0,
    runs: [run("run-gmail-1", "job-gmail", "2026-09-30T11:55:00+05:30", "running", 1, [step("11:55:00", "gmail.history.list", "startHistoryId=8841022 → 8841390", 0), step("11:55:06", "normalize.parse", "41 messages, 12 attachments", 0), step("11:55:13", "index.upsert", "96 chunks written", 0)])],
  },
  {
    jobId: "job-drive", name: "Drive folder sync", description: "Walks the projects shared drive and queues changed files.", schedule: "hourly", status: "ok", lastRunAt: "2026-09-30T11:00:00+05:30", durationSec: 96, tokensToday: 0,
    runs: [run("run-drive-1", "job-drive", "2026-09-30T11:00:00+05:30", "ok", 1, [step("11:00:00", "drive.changes.list", "214 changes", 0), step("11:01:10", "normalize.parse", "Docling: 38 files, 2 need OCR", 0), step("11:01:36", "index.upsert", "512 chunks written", 0)])],
  },
  {
    jobId: "job-whatsapp-media", name: "WhatsApp media fetch", description: "Downloads media referenced in exported chats.", schedule: "every 15 min", status: "retrying", lastRunAt: "2026-09-30T11:45:00+05:30", durationSec: 33, tokensToday: 0,
    runs: [
      run("run-wa-2", "job-whatsapp-media", "2026-09-30T11:45:00+05:30", "retrying", 2, [
        step("11:45:00", "whatsapp.export.read", "queue depth 6", 0),
        step("11:45:12", "media.fetch", "2 files returned 429", 0, "Rate limited by the export host. Retrying with backoff (attempt 2 of 5)."),
      ]),
      run("run-wa-1", "job-whatsapp-media", "2026-09-30T11:30:00+05:30", "failed", 1, [step("11:30:00", "media.fetch", "2 files returned 429", 0, "Rate limited by the export host.")]),
    ],
  },
  {
    jobId: "job-budget-audit", name: "Budget audit", description: "Recomputes variance by package from the ledger and flags movements.", schedule: "hourly", status: "ok", lastRunAt: "2026-09-30T11:00:00+05:30", durationSec: 9, tokensToday: 38_200,
    runs: [run("run-budget-1", "job-budget-audit", "2026-09-30T11:00:00+05:30", "ok", 1, [step("11:00:00", "sql.finance_variance_by_package", "4 projects, 22 packages", 0), step("11:00:04", "llm.fast", "summarise 3 movements", 38_200)])],
  },
  {
    jobId: "job-gardening", name: "Nightly knowledge gardening", description: "Merges duplicate entities and repairs broken graph links.", schedule: "daily 02:00", status: "ok", lastRunAt: "2026-09-30T02:00:00+05:30", durationSec: 1420, tokensToday: 412_000,
    runs: [run("run-garden-1", "job-gardening", "2026-09-30T02:00:00+05:30", "ok", 1, [step("02:00:00", "graph.scan", "9,804 entities", 0), step("02:14:10", "llm.reason", "41 merge proposals", 412_000), step("02:23:40", "graph.apply", "38 merged, 3 sent for review", 0)])],
  },
  {
    jobId: "job-reindex", name: "Document re-indexing", description: "Re-chunks documents whose parser version changed.", schedule: "daily 03:30", status: "running", lastRunAt: "2026-09-30T11:40:00+05:30", durationSec: 1200, tokensToday: 96_000,
    runs: [run("run-reindex-1", "job-reindex", "2026-09-30T11:40:00+05:30", "running", 1, [step("11:40:00", "index.plan", "1,120 documents", 0), step("11:52:00", "embed.batch", "640 of 1,120", 96_000)])],
  },
  {
    jobId: "job-decisions", name: "Decision extraction", description: "Finds decisions in new threads and chats and queues them as drafts.", schedule: "every 30 min", status: "ok", lastRunAt: "2026-09-30T11:30:00+05:30", durationSec: 52, tokensToday: 268_000,
    runs: [run("run-dec-1", "job-decisions", "2026-09-30T11:30:00+05:30", "ok", 1, [step("11:30:00", "retrieve.recent", "63 new threads", 0), step("11:30:40", "llm.reason", "2 draft decisions", 268_000)])],
  },
  {
    jobId: "job-entities", name: "Entity resolution sweep", description: "Matches vendor names across email, WhatsApp and the ledger.", schedule: "daily 01:00", status: "ok", lastRunAt: "2026-09-30T01:00:00+05:30", durationSec: 640, tokensToday: 184_000,
    runs: [run("run-ent-1", "job-entities", "2026-09-30T01:00:00+05:30", "ok", 1, [step("01:00:00", "er.candidates", "112 pairs", 0), step("01:08:00", "llm.fast", "judge 29 ambiguous pairs", 184_000)])],
  },
  {
    jobId: "job-ageing", name: "Receivables ageing refresh", description: "Refreshes open receivables and ageing buckets.", schedule: "hourly", status: "ok", lastRunAt: "2026-09-30T11:00:00+05:30", durationSec: 6, tokensToday: 0,
    runs: [run("run-age-1", "job-ageing", "2026-09-30T11:00:00+05:30", "ok", 1, [step("11:00:00", "sql.finance_receivables_ageing", "8 open invoices", 0)])],
  },
  {
    jobId: "job-revisions", name: "Drawing revision watcher", description: "Detects new drawing revisions and supersedes older ones.", schedule: "every 30 min", status: "queued", lastRunAt: "2026-09-30T11:30:00+05:30", durationSec: 21, tokensToday: 22_000,
    runs: [run("run-rev-1", "job-revisions", "2026-09-30T11:30:00+05:30", "ok", 1, [step("11:30:00", "drive.changes.list", "0 new drawings", 0)])],
  },
  {
    jobId: "job-embed-backfill", name: "Embedding backfill", description: "Embeds chunks written while the embedding alias was unavailable.", schedule: "daily 04:30", status: "queued", lastRunAt: "2026-09-30T04:30:00+05:30", durationSec: 310, tokensToday: 118_000,
    runs: [run("run-embed-1", "job-embed-backfill", "2026-09-30T04:30:00+05:30", "ok", 1, [step("04:30:00", "embed.batch", "4,100 chunks", 118_000)])],
  },
  {
    jobId: "job-audit-export", name: "Audit log export", description: "Writes the append-only audit log to the tenant bucket.", schedule: "daily 23:00", status: "queued", lastRunAt: "2026-09-29T23:00:00+05:30", durationSec: 18, tokensToday: 0,
    runs: [run("run-audit-1", "job-audit-export", "2026-09-29T23:00:00+05:30", "ok", 1, [step("23:00:00", "audit.export", "1,204 events", 0)])],
  },
];

// ---------------------------------------------------------------- spaces
const SPACES: Space[] = [
  {
    spaceId: "sp-phx-structural", name: "phoenix-structural", topic: "Steel, transfer beam and RFIs for Phoenix", projectId: "phoenix", members: ["Project lead (Phoenix)", "Site engineer", "Structural consultant", "Principal architect"], unread: 3, pinnedDocumentIds: ["d-phx-str204-c", "d-phx-rfi27", "d-phx-ismb450", "d-phx-boq"], agentRuns: 2,
    messages: [
      { messageId: "sm-1", author: "Structural consultant", at: "2026-09-29T16:20:00+05:30", text: "RFI-27 is in your inbox. Please confirm the ISMB 450 section before fabrication.", documentId: "d-phx-rfi27", reactions: [{ emoji: "👍", count: 2 }] },
      { messageId: "sm-2", author: "Project lead (Phoenix)", at: "2026-09-29T18:45:00+05:30", text: "@Structural consultant confirmed for the C–D bay at ₹92,000 per tonne. Holding the rest until Friday.", mentions: ["Structural consultant"], replies: [{ author: "Structural consultant", at: "2026-09-29T19:02:00+05:30", text: "Noted. I will release the shop drawings tomorrow." }] },
      { messageId: "sm-3", author: "Site engineer", at: "2026-09-30T08:15:00+05:30", text: "Voice note on bay C–D attached.", documentId: "d-phx-voice", reactions: [{ emoji: "✅", count: 1 }] },
    ],
  },
  {
    spaceId: "sp-mep", name: "mep-coordination", topic: "MEP clashes and approvals across projects", members: ["Project lead (Phoenix)", "Site engineer", "Principal architect"], unread: 0, pinnedDocumentIds: ["d-mc-hvac-c"], agentRuns: 0,
    messages: [{ messageId: "sm-4", author: "Principal architect", at: "2026-09-10T11:00:00+05:30", text: "HVAC Rev C is out. OT at 25 air changes with HEPA; AHU moves to the terrace.", documentId: "d-mc-hvac-c" }],
  },
  {
    spaceId: "sp-marigold-ot", name: "marigold-ot", topic: "Minor OT finishes and infection control", projectId: "marigold", members: ["Principal architect", "Site engineer", "Accounts"], unread: 1, pinnedDocumentIds: ["d-mc-hvac-c"], agentRuns: 1,
    messages: [{ messageId: "sm-5", author: "Principal architect", at: "2026-09-24T10:00:00+05:30", text: "Client asked for seamless coved PVC in the OT. @Accounts please price the difference against epoxy.", mentions: ["Accounts"] }],
  },
  {
    spaceId: "sp-finance", name: "finance-weekly", topic: "Receivables, payables and the weekly cash call", members: ["Principal architect", "Accounts"], unread: 0, pinnedDocumentIds: [], agentRuns: 3,
    messages: [{ messageId: "sm-6", author: "Accounts", at: "2026-09-28T17:00:00+05:30", text: "Reminder drafts for the two oldest receivables are waiting in Approvals." }],
  },
  {
    spaceId: "sp-site-daily", name: "site-daily", topic: "Daily site notes from all four sites", members: ["Site engineer", "Project lead (Phoenix)", "Interiors lead"], unread: 5, pinnedDocumentIds: ["d-phx-photo", "d-phx-drone"], agentRuns: 0,
    messages: [{ messageId: "sm-7", author: "Site engineer", at: "2026-09-29T09:30:00+05:30", text: "Level 2 slab shuttering ready for the pre-pour check.", documentId: "d-phx-photo", reactions: [{ emoji: "👍", count: 3 }] }],
  },
];

// ---------------------------------------------------------------- apps
const APPS: AppDef[] = [
  { appId: "gmail", name: "Gmail", vendor: "Google", kind: "connector", description: "Reads mail for mapped labels. Nothing is sent without an approval.", scopes: ["gmail.readonly", "gmail.labels"], status: "connected", connectorType: "gmail", oauth: "granted", webhookPath: "/hooks/gmail", category: "Email & chat" },
  { appId: "drive", name: "Google Drive", vendor: "Google", kind: "connector", description: "Indexes drawings, contracts and BOQs in shared drives.", scopes: ["drive.readonly", "drive.metadata.readonly"], status: "connected", connectorType: "drive", oauth: "granted", webhookPath: "/hooks/drive", category: "Files" },
  { appId: "sheets", name: "Google Sheets", vendor: "Google", kind: "connector", description: "Reads the finance workbook that feeds the ledger.", scopes: ["spreadsheets.readonly"], status: "connected", connectorType: "sheets", oauth: "granted", category: "Finance" },
  { appId: "whatsapp", name: "WhatsApp Cloud", vendor: "Meta", kind: "connector", description: "Chat exports and the WhatsApp Cloud webhook for site groups.", scopes: ["messages.read", "media.read"], status: "connected", connectorType: "whatsapp", oauth: "granted", webhookPath: "/hooks/whatsapp", category: "Email & chat" },
  { appId: "calendar", name: "Google Calendar", vendor: "Google", kind: "connector", description: "Imports meetings and attendees for prep briefs.", scopes: ["calendar.readonly"], status: "connected", connectorType: "calendar", oauth: "granted", category: "Calendar" },
  { appId: "procore", name: "Procore", vendor: "Procore", kind: "mcp", description: "RFIs, submittals and daily logs from Procore projects.", scopes: ["projects.read", "rfis.read"], status: "available", oauth: "not_connected", category: "Construction" },
  { appId: "bim360", name: "Autodesk BIM 360", vendor: "Autodesk", kind: "mcp", description: "Model and sheet versions from BIM 360 Docs.", scopes: ["data:read"], status: "available", oauth: "not_connected", category: "Design" },
  { appId: "tally", name: "Tally Prime", vendor: "Tally Solutions", kind: "mcp", description: "Ledger exports for the Finance views.", scopes: ["ledger.read"], status: "available", oauth: "not_connected", category: "Finance" },
];

// ---------------------------------------------------------------- history (questions asked in the last weeks)
const H = (n: number, at: string, question: string, topic: string, helpful: boolean | undefined, projectId?: string): HistoryItem => ({ historyId: `h-${n}`, at, question, topic, helpful, projectId, userId: "dev-user" });
const HISTORY: HistoryItem[] = [
  H(1, "2026-09-30T09:10:00+05:30", "Why is Phoenix over budget?", "Phoenix", true, "phoenix"),
  H(2, "2026-09-30T08:40:00+05:30", "Which client payments are overdue?", "Finance", true),
  H(3, "2026-09-29T17:05:00+05:30", "What is the latest structural drawing for Phoenix?", "Phoenix", true, "phoenix"),
  H(4, "2026-09-28T12:20:00+05:30", "What did we decide about the Phoenix facade?", "Decisions", true, "phoenix"),
  H(5, "2026-09-27T16:00:00+05:30", "What changed on Lotus Villa recently?", "Lotus Villa", false, "lotus"),
  H(6, "2026-09-25T10:30:00+05:30", "What changed on Marigold Clinic recently?", "Marigold Clinic", true, "marigold"),
  H(7, "2026-09-24T14:10:00+05:30", "What did we decide about the Banyan handover?", "Decisions", true, "banyan"),
  H(8, "2026-09-22T09:00:00+05:30", "Which client payments are overdue?", "Finance", true),
  H(9, "2026-09-18T15:45:00+05:30", "Why is Marigold Clinic over budget?", "Marigold Clinic", undefined, "marigold"),
  H(10, "2026-09-10T11:15:00+05:30", "What is the latest structural drawing for Phoenix?", "Phoenix", true, "phoenix"),
  H(11, "2026-08-28T10:05:00+05:30", "What did we decide about the Lotus flooring?", "Decisions", true, "lotus"),
  H(12, "2026-08-14T13:30:00+05:30", "Which client payments are overdue?", "Finance", true),
];

const RETENTION: RetentionPolicy = {
  days: 1095,
  kmsKeyAlias: "alias/klarity-tenant-0fdc5142",
  kmsKeyState: "active",
  lastRotatedAt: "2026-07-01T00:00:00+05:30",
  auditExportAt: "2026-09-29T23:00:00+05:30",
};

export const STUDIO8_OPS: Pick<WorkspaceDataset, "jobs" | "spaces" | "activity" | "apps" | "history" | "retention" | "agentTokenCap"> = {
  jobs: JOBS,
  spaces: SPACES,
  activity: [
    { id: "ac-1", at: "2026-09-29T16:12:00+05:30", actor: "Structural consultant", verb: "uploaded", target: "RFI-27.pdf", projectId: "phoenix" },
    { id: "ac-2", at: "2026-09-29T09:20:00+05:30", actor: "Site engineer", verb: "uploaded", target: "Level 2 slab shuttering (photo)", projectId: "phoenix" },
    { id: "ac-3", at: "2026-09-30T11:55:00+05:30", actor: "Gmail sync", verb: "synced", target: "Partners mailbox · 41 new messages" },
    { id: "ac-4", at: "2026-09-30T11:00:00+05:30", actor: "Drive sync", verb: "synced", target: "Projects shared drive · 214 changes" },
    { id: "ac-5", at: "2026-09-25T10:00:00+05:30", actor: "Principal architect", verb: "uploaded", target: "Client progress deck — September", projectId: "phoenix" },
    { id: "ac-6", at: "2026-09-24T09:00:00+05:30", actor: "Structural consultant", verb: "joined", target: "Studio 8 Hats as a guest" },
  ],
  apps: APPS,
  history: HISTORY,
  retention: RETENTION,
  agentTokenCap: 2_800_000,
};
