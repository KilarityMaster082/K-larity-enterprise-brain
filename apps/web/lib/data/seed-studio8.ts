// Owner task: EB-23 Web UI shell — DEMO DATA for the Studio 8 workspace (development only).
// Fictional projects shaped like DB schema v1. People are role labels, not invented staff names. Totals are
// never typed here: pages derive them from these rows (lib/data/derive.ts), the way SQL will.
import type { Evidence, SourceType } from "../contracts";
import type {
  Approval,
  AuditEvent,
  BudgetLine,
  Decision,
  DocumentItem,
  FinanceTxn,
  Member,
  Person,
  Project,
  ProjectEvent,
  Source,
  TenantDataset,
} from "./types";

const AEC_STAGES = ["Concept", "Design", "GFC drawings", "Execution", "Handover"]; // from packs/aec

function ev(
  id: string,
  sourceType: SourceType,
  title: string,
  excerpt: string,
  quote: string,
  extra: Partial<Evidence> = {},
): Evidence {
  const start = excerpt.indexOf(quote);
  if (start < 0) throw new Error(`evidence ${id}: quote not found`);
  return { id, sourceType, title, excerpt, highlight: { start, end: start + quote.length }, ...extra };
}

const inr = (n: number) => "₹" + new Intl.NumberFormat("en-IN").format(n);

// ---------------------------------------------------------------- people
const people: Person[] = [
  { personId: "p-principal", name: "Principal architect", org: "Studio 8 Hats", kind: "staff" },
  { personId: "p-lead-phx", name: "Project lead (Phoenix)", org: "Studio 8 Hats", kind: "staff" },
  { personId: "p-lead-int", name: "Interiors lead", org: "Studio 8 Hats", kind: "staff" },
  { personId: "p-site", name: "Site engineer", org: "Studio 8 Hats", kind: "staff" },
  { personId: "p-accounts", name: "Accounts", org: "Studio 8 Hats", kind: "staff" },
  { personId: "p-client-phx", name: "Client representative", org: "Phoenix client", kind: "client" },
  { personId: "p-client-mc", name: "Clinic administrator", org: "Marigold Clinic", kind: "client" },
  { personId: "p-client-lv", name: "Homeowner", org: "Lotus Villa", kind: "client" },
  { personId: "p-client-bo", name: "Facilities manager", org: "Banyan Office", kind: "client" },
  { personId: "p-facade", name: "Facade vendor", org: "Skyline Facades", kind: "vendor" },
  { personId: "p-struct", name: "Structural consultant", org: "Vertex Structures", kind: "consultant" },
  { personId: "p-interiors", name: "Interiors vendor", org: "Sri Sai Interiors", kind: "vendor" },
];

// ---------------------------------------------------------------- projects & budgets
const projects: Project[] = [
  {
    projectId: "phoenix",
    name: "Project Phoenix",
    code: "PHX",
    client: "Phoenix client",
    location: "Jubilee Hills, Hyderabad",
    description: "G+2 private residence with a steel transfer level and a ventilated HPL facade.",
    status: "active",
    stages: AEC_STAGES,
    currentStage: 3,
    budget: 15300000,
    leadId: "p-lead-phx",
    peopleIds: ["p-principal", "p-lead-phx", "p-site", "p-accounts", "p-client-phx", "p-facade", "p-struct"],
    startedOn: "2026-02-02",
    dueOn: "2027-01-30",
  },
  {
    projectId: "marigold",
    name: "Marigold Clinic",
    code: "MC",
    client: "Marigold Clinic",
    location: "Kondapur, Hyderabad",
    description: "Outpatient clinic fit-out: consultation rooms, minor OT and pharmacy.",
    status: "active",
    stages: AEC_STAGES,
    currentStage: 2,
    budget: 9200000,
    leadId: "p-principal",
    peopleIds: ["p-principal", "p-site", "p-accounts", "p-client-mc"],
    startedOn: "2026-05-11",
    dueOn: "2026-12-20",
  },
  {
    projectId: "lotus",
    name: "Lotus Villa",
    code: "LV",
    client: "Lotus Villa",
    location: "Gachibowli, Hyderabad",
    description: "Full interiors for a four-bedroom villa.",
    status: "active",
    stages: AEC_STAGES,
    currentStage: 1,
    budget: 6800000,
    leadId: "p-lead-int",
    peopleIds: ["p-lead-int", "p-accounts", "p-client-lv", "p-interiors"],
    startedOn: "2026-07-01",
    dueOn: "2027-03-15",
  },
  {
    projectId: "banyan",
    name: "Banyan Office fit-out",
    code: "BO",
    client: "Banyan Office",
    location: "Madhapur, Hyderabad",
    description: "12,000 sq ft office fit-out; snag closure before handover.",
    status: "active",
    stages: AEC_STAGES,
    currentStage: 4,
    budget: 12000000,
    leadId: "p-principal",
    peopleIds: ["p-principal", "p-site", "p-accounts", "p-client-bo"],
    startedOn: "2026-01-12",
    dueOn: "2026-10-15",
  },
];

const budgetLines: BudgetLine[] = [
  // Phoenix: ₹1,53,00,000
  { projectId: "phoenix", package: "Civil & structure", budget: 5200000 },
  { projectId: "phoenix", package: "Structural steel", budget: 1800000 },
  { projectId: "phoenix", package: "Facade", budget: 1480000 },
  { projectId: "phoenix", package: "MEP", budget: 2400000 },
  { projectId: "phoenix", package: "Finishes", budget: 2920000 },
  { projectId: "phoenix", package: "Site labour", budget: 1500000 },
  // Marigold: ₹92,00,000
  { projectId: "marigold", package: "Civil & partitions", budget: 2600000 },
  { projectId: "marigold", package: "MEP & medical gases", budget: 3400000 },
  { projectId: "marigold", package: "Finishes", budget: 2200000 },
  { projectId: "marigold", package: "Furniture", budget: 1000000 },
  // Lotus: ₹68,00,000
  { projectId: "lotus", package: "Joinery", budget: 3000000 },
  { projectId: "lotus", package: "Flooring & stone", budget: 1800000 },
  { projectId: "lotus", package: "Lighting & electrical", budget: 1000000 },
  { projectId: "lotus", package: "Soft furnishing", budget: 1000000 },
  // Banyan: ₹1,20,00,000
  { projectId: "banyan", package: "Civil & partitions", budget: 3000000 },
  { projectId: "banyan", package: "MEP", budget: 3800000 },
  { projectId: "banyan", package: "Finishes", budget: 2700000 },
  { projectId: "banyan", package: "Furniture", budget: 2500000 },
];

// ---------------------------------------------------------------- ledger rows (+ generated evidence)
type TxnSeed = Omit<FinanceTxn, "evidenceId"> & { src?: SourceType };
const txnSeeds: TxnSeed[] = [
  // Phoenix payables (committed cost by package)
  { txnId: "phx-v-001", projectId: "phoenix", txnType: "invoice", txnRef: "VS/2026/118", amount: 1800000, direction: "payable", package: "Civil & structure", status: "completed", counterparty: "Vertex Civil Works", txnDate: "2026-03-20" },
  { txnId: "phx-v-002", projectId: "phoenix", txnType: "invoice", txnRef: "VS/2026/164", amount: 2000000, direction: "payable", package: "Civil & structure", status: "completed", counterparty: "Vertex Civil Works", txnDate: "2026-05-22" },
  { txnId: "phx-v-003", projectId: "phoenix", txnType: "invoice", txnRef: "VS/2026/219", amount: 1400000, direction: "payable", package: "Civil & structure", status: "pending", counterparty: "Vertex Civil Works", txnDate: "2026-09-18", dueDate: "2026-10-18" },
  { txnId: "phx-v-004", projectId: "phoenix", txnType: "invoice", txnRef: "SS-4410", amount: 1800000, direction: "payable", package: "Structural steel", status: "completed", counterparty: "Deccan Steel", txnDate: "2026-06-10" },
  { txnId: "phx-v-005", projectId: "phoenix", txnType: "change_order", txnRef: "SS-CO-02", amount: 610000, direction: "payable", package: "Structural steel", status: "pending", counterparty: "Deccan Steel", txnDate: "2026-08-04", dueDate: "2026-10-04" },
  { txnId: "phx-v-006", projectId: "phoenix", txnType: "invoice", txnRef: "SKF/PHX/01", amount: 1200000, direction: "payable", package: "Facade", status: "completed", counterparty: "Skyline Facades", txnDate: "2026-08-28" },
  { txnId: "phx-v-007", projectId: "phoenix", txnType: "invoice", txnRef: "SKF/PHX/02", amount: 1200000, direction: "payable", package: "Facade", status: "pending", counterparty: "Skyline Facades", txnDate: "2026-09-25", dueDate: "2026-10-25" },
  { txnId: "phx-v-008", projectId: "phoenix", txnType: "invoice", txnRef: "MEPX-771", amount: 1400000, direction: "payable", package: "MEP", status: "completed", counterparty: "Aqua MEP", txnDate: "2026-07-15" },
  { txnId: "phx-v-009", projectId: "phoenix", txnType: "invoice", txnRef: "MEPX-802", amount: 1000000, direction: "payable", package: "MEP", status: "pending", counterparty: "Aqua MEP", txnDate: "2026-09-12", dueDate: "2026-10-12" },
  { txnId: "phx-v-010", projectId: "phoenix", txnType: "invoice", txnRef: "FN-2291", amount: 1620000, direction: "payable", package: "Finishes", status: "completed", counterparty: "Stone & Tile Co", txnDate: "2026-08-02" },
  { txnId: "phx-v-011", projectId: "phoenix", txnType: "invoice", txnRef: "FN-2350", amount: 1300000, direction: "payable", package: "Finishes", status: "pending", counterparty: "Stone & Tile Co", txnDate: "2026-09-21", dueDate: "2026-10-21" },
  { txnId: "phx-v-012", projectId: "phoenix", txnType: "invoice", txnRef: "LAB-PHX-Q2", amount: 1500000, direction: "payable", package: "Site labour", status: "completed", counterparty: "Labour contractor", txnDate: "2026-07-31" },
  { txnId: "phx-v-013", projectId: "phoenix", txnType: "invoice", txnRef: "LAB-PHX-SEP", amount: 310000, direction: "payable", package: "Site labour", status: "pending", counterparty: "Labour contractor", txnDate: "2026-09-27", dueDate: "2026-10-12" },
  // Phoenix receivables
  { txnId: "phx-c-001", projectId: "phoenix", txnType: "invoice", txnRef: "S8/PHX/RA-1", amount: 4000000, direction: "receivable", status: "completed", counterparty: "Phoenix client", txnDate: "2026-04-05", dueDate: "2026-04-20" },
  { txnId: "phx-c-002", projectId: "phoenix", txnType: "invoice", txnRef: "S8/PHX/RA-2", amount: 4500000, direction: "receivable", status: "completed", counterparty: "Phoenix client", txnDate: "2026-07-05", dueDate: "2026-07-20" },
  { txnId: "phx-c-003", projectId: "phoenix", txnType: "invoice", txnRef: "S8/PHX/RA-3", amount: 3800000, direction: "receivable", status: "pending", counterparty: "Phoenix client", txnDate: "2026-09-20", dueDate: "2026-10-10" },
  // Marigold
  { txnId: "mc-v-001", projectId: "marigold", txnType: "invoice", txnRef: "MG-CIV-01", amount: 2400000, direction: "payable", package: "Civil & partitions", status: "completed", counterparty: "Vertex Civil Works", txnDate: "2026-07-10" },
  { txnId: "mc-v-002", projectId: "marigold", txnType: "invoice", txnRef: "MG-MEP-01", amount: 2100000, direction: "payable", package: "MEP & medical gases", status: "completed", counterparty: "Aqua MEP", txnDate: "2026-08-14" },
  { txnId: "mc-v-003", projectId: "marigold", txnType: "invoice", txnRef: "MG-MEP-02", amount: 1500000, direction: "payable", package: "MEP & medical gases", status: "pending", counterparty: "Aqua MEP", txnDate: "2026-09-19", dueDate: "2026-10-19" },
  { txnId: "mc-c-001", projectId: "marigold", txnType: "invoice", txnRef: "S8/MC/RA-1", amount: 3000000, direction: "receivable", status: "completed", counterparty: "Marigold Clinic", txnDate: "2026-06-20", dueDate: "2026-07-05" },
  { txnId: "mc-c-002", projectId: "marigold", txnType: "invoice", txnRef: "S8/MC/RA-2", amount: 2200000, direction: "receivable", status: "overdue", counterparty: "Marigold Clinic", txnDate: "2026-08-21", dueDate: "2026-09-05" },
  // Lotus
  { txnId: "lv-v-001", projectId: "lotus", txnType: "invoice", txnRef: "SSI/2231", amount: 240000, direction: "payable", package: "Joinery", status: "completed", counterparty: "Sri Sai Interiors", txnDate: "2026-09-08", src: "email" },
  { txnId: "lv-v-002", projectId: "lotus", txnType: "invoice", txnRef: "SSI/2231", amount: 240000, direction: "payable", package: "Joinery", status: "pending", counterparty: "Sri Sai Interiors", txnDate: "2026-09-11", dueDate: "2026-10-11", src: "whatsapp" },
  { txnId: "lv-v-003", projectId: "lotus", txnType: "invoice", txnRef: "SSI/2204", amount: 1150000, direction: "payable", package: "Joinery", status: "completed", counterparty: "Sri Sai Interiors", txnDate: "2026-08-12" },
  { txnId: "lv-c-001", projectId: "lotus", txnType: "invoice", txnRef: "S8/LV/DES-1", amount: 1200000, direction: "receivable", status: "completed", counterparty: "Lotus Villa", txnDate: "2026-07-15", dueDate: "2026-07-30" },
  { txnId: "lv-c-002", projectId: "lotus", txnType: "invoice", txnRef: "S8/LV/DES-2", amount: 800000, direction: "receivable", status: "pending", counterparty: "Lotus Villa", txnDate: "2026-09-25", dueDate: "2026-10-20" },
  // Banyan
  { txnId: "bo-v-001", projectId: "banyan", txnType: "invoice", txnRef: "BN-CIV-03", amount: 3100000, direction: "payable", package: "Civil & partitions", status: "completed", counterparty: "Vertex Civil Works", txnDate: "2026-05-30" },
  { txnId: "bo-v-002", projectId: "banyan", txnType: "invoice", txnRef: "BN-MEP-04", amount: 3700000, direction: "payable", package: "MEP", status: "completed", counterparty: "Aqua MEP", txnDate: "2026-07-18" },
  { txnId: "bo-v-003", projectId: "banyan", txnType: "invoice", txnRef: "BN-FIN-02", amount: 2650000, direction: "payable", package: "Finishes", status: "completed", counterparty: "Stone & Tile Co", txnDate: "2026-08-22" },
  { txnId: "bo-v-004", projectId: "banyan", txnType: "invoice", txnRef: "BN-FUR-01", amount: 2400000, direction: "payable", package: "Furniture", status: "pending", counterparty: "Workspace Furniture", txnDate: "2026-09-15", dueDate: "2026-10-15" },
  { txnId: "bo-c-001", projectId: "banyan", txnType: "invoice", txnRef: "S8/BO/RA-1..4", amount: 9000000, direction: "receivable", status: "completed", counterparty: "Banyan Office", txnDate: "2026-07-31", dueDate: "2026-08-15" },
  { txnId: "bo-c-002", projectId: "banyan", txnType: "invoice", txnRef: "S8/BO/FINAL", amount: 1800000, direction: "receivable", status: "overdue", counterparty: "Banyan Office", txnDate: "2026-08-13", dueDate: "2026-08-28" },
];

const txnEvidence: Evidence[] = [];
const txns: FinanceTxn[] = txnSeeds.map(({ src, ...t }) => {
  const evidenceId = `ev-${t.txnId}`;
  const kind = t.txnType === "change_order" ? "Change order" : "Invoice";
  const who = t.direction === "receivable" ? `issued by Studio 8 Hats to ${t.counterparty}` : `from ${t.counterparty}`;
  const amountText = `Amount: ${inr(t.amount)}`;
  const excerpt =
    `${kind} ${t.txnRef} ${who}` +
    (t.package ? ` for ${t.package}` : "") +
    `. Dated ${t.txnDate}. ${amountText}.` +
    (t.dueDate ? ` Due ${t.dueDate}.` : "");
  txnEvidence.push(
    ev(evidenceId, src ?? (t.direction === "receivable" ? "sheet" : "email"), `${kind} ${t.txnRef}`, excerpt, amountText, {
      author: t.direction === "receivable" ? "Accounts" : t.counterparty,
      occurredAt: `${t.txnDate}T10:00:00+05:30`,
      project: projects.find((p) => p.projectId === t.projectId)?.name,
    }),
  );
  return { ...t, evidenceId };
});

// ---------------------------------------------------------------- hand-written evidence (messages, drawings, notes)
const narrative: Evidence[] = [
  ev(
    "ev-phx-budget",
    "sheet",
    "Phoenix — Budget vs Actual (Finance ledger)",
    "Approved budget: ₹1,53,00,000. Committed + forecast to complete: ₹1,71,40,000. Variance: ₹18,40,000 (12.0%). Largest movements: Facade (+₹9,20,000), Structural steel (+₹6,10,000), Site labour (+₹3,10,000).",
    "Variance: ₹18,40,000 (12.0%)",
    { project: "Project Phoenix", occurredAt: "2026-09-28T18:30:00+05:30", author: "Accounts" },
  ),
  ev(
    "ev-phx-client-hpl",
    "whatsapp",
    "Phoenix client group",
    "Saw the HPL samples at site today. We prefer the HPL panels over ACP for the front facade even if it costs more — please go ahead and update the drawings.",
    "We prefer the HPL panels over ACP for the front facade even if it costs more",
    { project: "Project Phoenix", occurredAt: "2026-08-12T11:04:00+05:30", author: "Client representative" },
  ),
  ev(
    "ev-phx-facade-quote",
    "email",
    "Revised quotation — facade cladding (HPL)",
    "As discussed, switching the front facade from ACP to HPL changes the cladding package from ₹14,80,000 to ₹24,00,000 including fixing system. Validity 30 days.",
    "from ₹14,80,000 to ₹24,00,000",
    { project: "Project Phoenix", occurredAt: "2026-08-19T16:20:00+05:30", author: "Facade vendor" },
  ),
  ev(
    "ev-phx-str204c",
    "drawing",
    "PHX-STR-204 Rev C (GFC) — transfer beam",
    "Rev C: transfer beam at level 2 revised from RCC to steel section ISMB 600 following the column shift. Supersedes Rev B.",
    "revised from RCC to steel section ISMB 600",
    { project: "Project Phoenix", occurredAt: "2026-07-30T10:00:00+05:30", author: "Structural consultant" },
  ),
  ev(
    "ev-phx-str204b",
    "drawing",
    "PHX-STR-204 Rev B — transfer beam",
    "Rev B: transfer beam at level 2 in RCC, 450 x 900. Issued for coordination.",
    "transfer beam at level 2 in RCC",
    { project: "Project Phoenix", occurredAt: "2026-06-18T10:00:00+05:30", author: "Structural consultant" },
  ),
  ev(
    "ev-phx-site-w36",
    "email",
    "Site update — week 36",
    "Steel delivery slipped by 3 weeks; masonry and MEP crews were retained on site to hold the schedule, adding labour cost for the period.",
    "Steel delivery slipped by 3 weeks",
    { project: "Project Phoenix", occurredAt: "2026-09-06T19:12:00+05:30", author: "Site engineer" },
  ),
  ev(
    "ev-phx-vo07",
    "document",
    "Variation order VO-07 (draft, unsigned)",
    "VO-07: Facade material change ACP → HPL. Amount ₹9,20,000. Status: sent to client for signature. Signature: pending.",
    "Signature: pending",
    { project: "Project Phoenix", occurredAt: "2026-09-02T12:00:00+05:30" },
  ),
  ev(
    "ev-phx-arc101",
    "drawing",
    "PHX-ARC-101 Rev D — ground floor plan",
    "Rev D: staircase shifted 600 mm east; column C4 relocated to clear the car porch. Supersedes Rev C.",
    "column C4 relocated",
    { project: "Project Phoenix", occurredAt: "2026-07-22T10:00:00+05:30", author: "Principal architect" },
  ),
  ev(
    "ev-phx-fac301",
    "drawing",
    "PHX-FAC-301 Rev B — front elevation",
    "Rev B: front facade cladding changed to 8 mm HPL panels on aluminium sub-frame, open-joint ventilated system.",
    "8 mm HPL panels on aluminium sub-frame",
    { project: "Project Phoenix", occurredAt: "2026-08-24T10:00:00+05:30", author: "Principal architect" },
  ),
  ev(
    "ev-mc-flooring",
    "whatsapp",
    "Marigold site group",
    "For the minor OT, can we do seamless PVC instead of epoxy? Infection control team prefers coved PVC. Please share the cost difference.",
    "can we do seamless PVC instead of epoxy",
    { project: "Marigold Clinic", occurredAt: "2026-09-24T09:40:00+05:30", author: "Clinic administrator" },
  ),
  ev(
    "ev-mc-hvac-c",
    "drawing",
    "MC-MEP-110 Rev C — HVAC layout",
    "Rev C: OT air changes increased to 25 per hour with HEPA terminal filters; AHU relocated to the terrace.",
    "OT air changes increased to 25 per hour",
    { project: "Marigold Clinic", occurredAt: "2026-09-10T10:00:00+05:30", author: "MEP consultant" },
  ),
  ev(
    "ev-mc-hvac-b",
    "drawing",
    "MC-MEP-110 Rev B — HVAC layout",
    "Rev B: OT at 20 air changes per hour; AHU in the service shaft.",
    "20 air changes per hour",
    { project: "Marigold Clinic", occurredAt: "2026-08-02T10:00:00+05:30", author: "MEP consultant" },
  ),
  ev(
    "ev-mc-reminder",
    "email",
    "Re: RA-2 payment",
    "We will process RA-2 after the board meeting. Please bear with us for a few more days.",
    "We will process RA-2 after the board meeting",
    { project: "Marigold Clinic", occurredAt: "2026-09-16T15:05:00+05:30", author: "Clinic administrator" },
  ),
  ev(
    "ev-lv-kitchen",
    "whatsapp",
    "Lotus Villa — homeowner",
    "Final call on the kitchen: acrylic shutters in matte white, handle-less profile. Please go ahead.",
    "acrylic shutters in matte white",
    { project: "Lotus Villa", occurredAt: "2026-08-30T20:15:00+05:30", author: "Homeowner" },
  ),
  ev(
    "ev-lv-marble",
    "email",
    "Flooring selection",
    "After the site visit we are switching from Italian to Indian (Makrana) marble for the living and dining floors to stay within budget.",
    "switching from Italian to Indian (Makrana) marble",
    { project: "Lotus Villa", occurredAt: "2026-09-04T12:30:00+05:30", author: "Homeowner" },
  ),
  ev(
    "ev-lv-marble-old",
    "whatsapp",
    "Lotus Villa — homeowner",
    "Let's go with Italian Statuario for the living room floor.",
    "Italian Statuario for the living room floor",
    { project: "Lotus Villa", occurredAt: "2026-07-20T18:02:00+05:30", author: "Homeowner" },
  ),
  ev(
    "ev-bo-handover",
    "email",
    "Handover plan",
    "We propose handover on 15 October once the 42 open snags are closed and the fire NOC is received.",
    "handover on 15 October once the 42 open snags are closed",
    { project: "Banyan Office fit-out", occurredAt: "2026-09-26T11:00:00+05:30", author: "Facilities manager" },
  ),
  ev(
    "ev-bo-snags",
    "document",
    "Snag list — 28 Sep",
    "Open snags: 42 (civil 11, MEP 17, finishes 14). Closed this week: 23. Critical: 3 (fire damper, DB labelling, emergency lighting).",
    "Open snags: 42",
    { project: "Banyan Office fit-out", occurredAt: "2026-09-28T17:00:00+05:30", author: "Site engineer" },
  ),
];

const evidence = [...narrative, ...txnEvidence];

// ---------------------------------------------------------------- events (project timelines)
const events: ProjectEvent[] = [
  { eventId: "e-phx-01", projectId: "phoenix", eventType: "drawing", occurredAt: "2026-06-18T10:00:00+05:30", title: "PHX-STR-204 Rev B issued", description: "Transfer beam in RCC.", evidenceId: "ev-phx-str204b" },
  { eventId: "e-phx-02", projectId: "phoenix", eventType: "drawing", occurredAt: "2026-07-22T10:00:00+05:30", title: "Ground floor plan Rev D", description: "Column C4 relocated.", evidenceId: "ev-phx-arc101" },
  { eventId: "e-phx-03", projectId: "phoenix", eventType: "drawing", occurredAt: "2026-07-30T10:00:00+05:30", title: "PHX-STR-204 Rev C (GFC)", description: "Transfer beam changed to steel ISMB 600.", evidenceId: "ev-phx-str204c" },
  { eventId: "e-phx-04", projectId: "phoenix", eventType: "invoice", occurredAt: "2026-08-04T10:00:00+05:30", title: "Steel change order SS-CO-02", description: "₹6.1 lakh for the Rev C transfer beam.", evidenceId: "ev-phx-v-005" },
  { eventId: "e-phx-05", projectId: "phoenix", eventType: "message", occurredAt: "2026-08-12T11:04:00+05:30", title: "Client chose HPL facade", description: "Client prefers HPL over ACP even at higher cost.", evidenceId: "ev-phx-client-hpl" },
  { eventId: "e-phx-06", projectId: "phoenix", eventType: "email", occurredAt: "2026-08-19T16:20:00+05:30", title: "Revised facade quotation", description: "₹14.8 lakh → ₹24 lakh.", evidenceId: "ev-phx-facade-quote" },
  { eventId: "e-phx-07", projectId: "phoenix", eventType: "drawing", occurredAt: "2026-08-24T10:00:00+05:30", title: "Front elevation Rev B", description: "HPL ventilated facade.", evidenceId: "ev-phx-fac301" },
  { eventId: "e-phx-08", projectId: "phoenix", eventType: "risk", occurredAt: "2026-09-02T12:00:00+05:30", title: "VO-07 sent for signature", description: "₹9.2 lakh variation, not yet signed.", evidenceId: "ev-phx-vo07" },
  { eventId: "e-phx-09", projectId: "phoenix", eventType: "site", occurredAt: "2026-09-06T19:12:00+05:30", title: "Steel delivery slipped 3 weeks", description: "Crews retained on site.", evidenceId: "ev-phx-site-w36" },
  { eventId: "e-phx-10", projectId: "phoenix", eventType: "invoice", occurredAt: "2026-09-20T10:00:00+05:30", title: "RA-3 raised to client", description: "₹38 lakh, due 10 Oct.", evidenceId: "ev-phx-c-003" },
  { eventId: "e-phx-11", projectId: "phoenix", eventType: "risk", occurredAt: "2026-09-28T18:30:00+05:30", title: "Budget variance reached 12%", evidenceId: "ev-phx-budget" },
  { eventId: "e-mc-01", projectId: "marigold", eventType: "drawing", occurredAt: "2026-08-02T10:00:00+05:30", title: "HVAC layout Rev B", evidenceId: "ev-mc-hvac-b" },
  { eventId: "e-mc-02", projectId: "marigold", eventType: "invoice", occurredAt: "2026-08-21T10:00:00+05:30", title: "RA-2 raised to client", description: "₹22 lakh, due 5 Sep.", evidenceId: "ev-mc-c-002" },
  { eventId: "e-mc-03", projectId: "marigold", eventType: "drawing", occurredAt: "2026-09-10T10:00:00+05:30", title: "HVAC layout Rev C", description: "OT at 25 air changes with HEPA.", evidenceId: "ev-mc-hvac-c" },
  { eventId: "e-mc-04", projectId: "marigold", eventType: "email", occurredAt: "2026-09-16T15:05:00+05:30", title: "Client delays RA-2 payment", evidenceId: "ev-mc-reminder" },
  { eventId: "e-mc-05", projectId: "marigold", eventType: "message", occurredAt: "2026-09-24T09:40:00+05:30", title: "Client asks for PVC in the OT", evidenceId: "ev-mc-flooring" },
  { eventId: "e-lv-01", projectId: "lotus", eventType: "message", occurredAt: "2026-07-20T18:02:00+05:30", title: "Italian marble chosen", evidenceId: "ev-lv-marble-old" },
  { eventId: "e-lv-02", projectId: "lotus", eventType: "message", occurredAt: "2026-08-30T20:15:00+05:30", title: "Kitchen shutters finalised", evidenceId: "ev-lv-kitchen" },
  { eventId: "e-lv-03", projectId: "lotus", eventType: "email", occurredAt: "2026-09-04T12:30:00+05:30", title: "Flooring switched to Makrana marble", evidenceId: "ev-lv-marble" },
  { eventId: "e-lv-04", projectId: "lotus", eventType: "invoice", occurredAt: "2026-09-11T10:00:00+05:30", title: "Invoice SSI/2231 received again", description: "Same number and amount as 8 Sep.", evidenceId: "ev-lv-v-002" },
  { eventId: "e-bo-01", projectId: "banyan", eventType: "invoice", occurredAt: "2026-08-13T10:00:00+05:30", title: "Final bill raised", description: "₹18 lakh, due 28 Aug.", evidenceId: "ev-bo-c-002" },
  { eventId: "e-bo-02", projectId: "banyan", eventType: "email", occurredAt: "2026-09-26T11:00:00+05:30", title: "Handover proposed for 15 Oct", evidenceId: "ev-bo-handover" },
  { eventId: "e-bo-03", projectId: "banyan", eventType: "site", occurredAt: "2026-09-28T17:00:00+05:30", title: "42 snags open, 3 critical", evidenceId: "ev-bo-snags" },
];

// ---------------------------------------------------------------- documents
const documents: DocumentItem[] = [
  { documentId: "d-phx-str204-c", projectId: "phoenix", title: "Transfer beam details", docType: "drawing", series: "PHX-STR-204", revision: "C", isLatest: true, source: "drive", updatedAt: "2026-07-30T10:00:00+05:30", sizeBytes: 2_400_000, summary: "GFC structural drawing: level-2 transfer beam in steel (ISMB 600).", facts: ["Transfer beam: steel ISMB 600", "Supersedes Rev B", "Issued for construction"], evidenceId: "ev-phx-str204c" },
  { documentId: "d-phx-str204-b", projectId: "phoenix", title: "Transfer beam details", docType: "drawing", series: "PHX-STR-204", revision: "B", isLatest: false, source: "drive", updatedAt: "2026-06-18T10:00:00+05:30", sizeBytes: 2_100_000, summary: "Coordination issue with an RCC transfer beam.", facts: ["Transfer beam: RCC 450 x 900"], evidenceId: "ev-phx-str204b" },
  { documentId: "d-phx-arc101-d", projectId: "phoenix", title: "Ground floor plan", docType: "drawing", series: "PHX-ARC-101", revision: "D", isLatest: true, source: "drive", updatedAt: "2026-07-22T10:00:00+05:30", sizeBytes: 3_800_000, summary: "Staircase and column C4 moved to clear the car porch.", facts: ["Staircase shifted 600 mm east", "Column C4 relocated"], evidenceId: "ev-phx-arc101" },
  { documentId: "d-phx-fac301-b", projectId: "phoenix", title: "Front elevation", docType: "drawing", series: "PHX-FAC-301", revision: "B", isLatest: true, source: "drive", updatedAt: "2026-08-24T10:00:00+05:30", sizeBytes: 5_200_000, summary: "Front facade in 8 mm HPL on an aluminium sub-frame.", facts: ["Cladding: 8 mm HPL", "Open-joint ventilated system"], evidenceId: "ev-phx-fac301" },
  { documentId: "d-phx-vo07", projectId: "phoenix", title: "Variation order VO-07 (facade ACP → HPL)", docType: "contract", isLatest: true, source: "gmail", updatedAt: "2026-09-02T12:00:00+05:30", sizeBytes: 180_000, summary: "₹9.2 lakh variation for the facade change, sent to the client for signature.", facts: ["Amount ₹9,20,000", "Signature pending"], evidenceId: "ev-phx-vo07", signed: false, amount: 920000 },
  { documentId: "d-phx-quote", projectId: "phoenix", title: "Revised quotation — facade cladding (HPL)", docType: "quotation", isLatest: true, source: "gmail", updatedAt: "2026-08-19T16:20:00+05:30", sizeBytes: 320_000, summary: "Facade package revised from ₹14.8 lakh to ₹24 lakh.", facts: ["Old: ₹14,80,000", "New: ₹24,00,000", "Valid 30 days"], evidenceId: "ev-phx-facade-quote", amount: 2400000 },
  { documentId: "d-phx-w36", projectId: "phoenix", title: "Site update — week 36", docType: "report", isLatest: true, source: "gmail", updatedAt: "2026-09-06T19:12:00+05:30", sizeBytes: 60_000, summary: "Steel delivery slipped three weeks; crews retained.", facts: ["Steel delay: 3 weeks"], evidenceId: "ev-phx-site-w36" },
  { documentId: "d-mc-hvac-c", projectId: "marigold", title: "HVAC layout", docType: "drawing", series: "MC-MEP-110", revision: "C", isLatest: true, source: "drive", updatedAt: "2026-09-10T10:00:00+05:30", sizeBytes: 4_100_000, summary: "OT at 25 air changes per hour with HEPA filters; AHU on the terrace.", facts: ["OT: 25 ACH", "HEPA terminal filters", "AHU on terrace"], evidenceId: "ev-mc-hvac-c" },
  { documentId: "d-mc-hvac-b", projectId: "marigold", title: "HVAC layout", docType: "drawing", series: "MC-MEP-110", revision: "B", isLatest: false, source: "drive", updatedAt: "2026-08-02T10:00:00+05:30", sizeBytes: 3_900_000, summary: "Earlier layout with 20 ACH in the OT.", facts: ["OT: 20 ACH"], evidenceId: "ev-mc-hvac-b" },
  { documentId: "d-lv-kitchen", projectId: "lotus", title: "Kitchen elevations", docType: "drawing", series: "LV-INT-210", revision: "A", isLatest: true, source: "drive", updatedAt: "2026-09-01T10:00:00+05:30", sizeBytes: 1_700_000, summary: "Acrylic matte-white shutters, handle-less profile.", facts: ["Shutters: acrylic, matte white"], evidenceId: "ev-lv-kitchen" },
  { documentId: "d-bo-snags", projectId: "banyan", title: "Snag list — 28 Sep", docType: "report", isLatest: true, source: "sheets", updatedAt: "2026-09-28T17:00:00+05:30", sizeBytes: 90_000, summary: "42 open snags, 3 critical; 23 closed this week.", facts: ["Open: 42", "Critical: 3"], evidenceId: "ev-bo-snags" },
];

// ---------------------------------------------------------------- decisions
const decisions: Decision[] = [
  { decisionId: "dec-phx-facade", projectId: "phoenix", title: "Front facade in HPL instead of ACP", description: "Client approved HPL panels for the front facade.", rationale: "Client preference after site samples.", status: "decided", decidedBy: "Client representative", decidedAt: "2026-08-12T11:04:00+05:30", alternatives: ["ACP (original)"], costImpact: 920000, evidenceIds: ["ev-phx-client-hpl", "ev-phx-facade-quote"] },
  { decisionId: "dec-phx-beam", projectId: "phoenix", title: "Level-2 transfer beam in steel (ISMB 600)", description: "Transfer beam changed from RCC to steel after the column shift.", rationale: "Column C4 relocation increased the span.", status: "decided", decidedBy: "Structural consultant", decidedAt: "2026-07-30T10:00:00+05:30", alternatives: ["Deeper RCC beam"], costImpact: 610000, evidenceIds: ["ev-phx-str204c", "ev-phx-arc101"] },
  { decisionId: "dec-phx-crews", projectId: "phoenix", title: "Keep masonry and MEP crews on site during the steel delay", description: "Crews retained for three weeks to hold the schedule.", status: "proposed", alternatives: ["Demobilise and remobilise later"], costImpact: 310000, timeImpactDays: 0, evidenceIds: ["ev-phx-site-w36"], confidence: 0.78 },
  { decisionId: "dec-mc-pvc", projectId: "marigold", title: "Seamless coved PVC flooring in the minor OT", description: "Client asked to replace epoxy with seamless PVC for infection control.", status: "proposed", alternatives: ["Epoxy (current spec)"], costImpact: 180000, evidenceIds: ["ev-mc-flooring"], confidence: 0.64 },
  { decisionId: "dec-mc-hvac", projectId: "marigold", title: "OT at 25 air changes per hour with HEPA", description: "HVAC upgraded for the minor OT.", status: "decided", decidedBy: "MEP consultant", decidedAt: "2026-09-10T10:00:00+05:30", alternatives: ["20 ACH (Rev B)"], evidenceIds: ["ev-mc-hvac-c", "ev-mc-hvac-b"] },
  { decisionId: "dec-lv-kitchen", projectId: "lotus", title: "Kitchen shutters in matte-white acrylic, handle-less", description: "Homeowner finalised the kitchen finish.", status: "decided", decidedBy: "Homeowner", decidedAt: "2026-08-30T20:15:00+05:30", alternatives: ["PU lacquer", "Laminate"], evidenceIds: ["ev-lv-kitchen"] },
  { decisionId: "dec-lv-marble-it", projectId: "lotus", title: "Italian Statuario marble for the living floor", description: "Original flooring choice.", status: "superseded", decidedBy: "Homeowner", decidedAt: "2026-07-20T18:02:00+05:30", supersededBy: "dec-lv-marble-in", alternatives: [], evidenceIds: ["ev-lv-marble-old"] },
  { decisionId: "dec-lv-marble-in", projectId: "lotus", title: "Indian (Makrana) marble for living and dining floors", description: "Switched from Italian marble to stay within budget.", status: "decided", decidedBy: "Homeowner", decidedAt: "2026-09-04T12:30:00+05:30", alternatives: ["Italian Statuario"], costImpact: -420000, evidenceIds: ["ev-lv-marble"] },
  { decisionId: "dec-bo-handover", projectId: "banyan", title: "Handover on 15 October after snag closure", description: "Facilities manager proposed handover once 42 snags close and the fire NOC arrives.", status: "proposed", alternatives: [], timeImpactDays: 0, evidenceIds: ["ev-bo-handover", "ev-bo-snags"], confidence: 0.82 },
];

// ---------------------------------------------------------------- approvals, sources, members, audit
const approvals: Approval[] = [
  { approvalId: "apr-001", kind: "draft_message", title: "Payment reminder to Marigold Clinic for RA-2", body: "Dear Clinic administrator,\n\nRA-2 (₹22,00,000) was due on 5 September. Could you confirm when the payment will be released? We have kept the MEP works on schedule for the OT.\n\nRegards,\nAccounts, Studio 8 Hats", projectId: "marigold", requestedBy: "Accounts", requestedVia: "ask_brain", requestedAt: "2026-09-29T10:15:00+05:30", reason: "RA-2 is 25 days overdue and the client last replied on 16 Sep.", evidenceIds: ["ev-mc-c-002", "ev-mc-reminder"], status: "pending" },
  { approvalId: "apr-002", kind: "create_task", title: "Raise a client variation for the Rev C steel", body: "Prepare VO-08 for the level-2 transfer beam change (₹6,10,000) and send it to the Phoenix client with PHX-STR-204 Rev C.", projectId: "phoenix", requestedBy: "Project lead (Phoenix)", requestedVia: "ask_brain", requestedAt: "2026-09-29T16:40:00+05:30", reason: "The steel change order is committed cost with no matching client variation.", evidenceIds: ["ev-phx-v-005", "ev-phx-str204c"], status: "pending" },
  { approvalId: "apr-000", kind: "draft_message", title: "Share Rev C structural drawings with the steel fabricator", body: "Please find PHX-STR-204 Rev C attached for fabrication.", projectId: "phoenix", requestedBy: "Project lead (Phoenix)", requestedVia: "person", requestedAt: "2026-07-30T12:00:00+05:30", reason: "Rev C issued for construction.", evidenceIds: ["ev-phx-str204c"], status: "approved", decidedBy: "Principal architect", decidedAt: "2026-07-30T13:05:00+05:30", note: "Approved." },
];

const sources: Source[] = [
  { sourceId: "src-gmail-partners", connectorType: "gmail", displayName: "Partners mailbox", account: "partners@studio8.example", health: "ok", lastSyncAt: "2026-09-30T11:57:00+05:30", itemsSeen: 18240, errorRate: 0.002, lagMinutes: 3, connectedAt: "2026-09-20T10:00:00+05:30" },
  { sourceId: "src-gmail-accounts", connectorType: "gmail", displayName: "Accounts mailbox", account: "accounts@studio8.example", health: "auth_error", lastSyncAt: "2026-09-28T09:10:00+05:30", itemsSeen: 6120, errorRate: 1, lastError: "Google revoked the refresh token. The mailbox owner must reconnect.", connectedAt: "2026-09-20T10:05:00+05:30" },
  { sourceId: "src-drive", connectorType: "drive", displayName: "Projects shared drive", account: "Studio 8 Projects", health: "ok", lastSyncAt: "2026-09-30T11:50:00+05:30", itemsSeen: 4310, errorRate: 0.004, lagMinutes: 10, connectedAt: "2026-09-20T10:10:00+05:30" },
  { sourceId: "src-sheets", connectorType: "sheets", displayName: "Finance workbook", account: "Budget & billing 2026", health: "ok", lastSyncAt: "2026-09-30T11:45:00+05:30", itemsSeen: 2210, errorRate: 0, lagMinutes: 15, connectedAt: "2026-09-20T10:12:00+05:30" },
  { sourceId: "src-whatsapp", connectorType: "whatsapp", displayName: "Phoenix client group (export)", account: "WhatsApp export", health: "degraded", lastSyncAt: "2026-09-30T08:00:00+05:30", itemsSeen: 3875, errorRate: 0.031, lagMinutes: 240, lastError: "2 media files could not be read (unsupported format).", connectedAt: "2026-09-21T09:00:00+05:30" },
];

const members: Member[] = [
  { userId: "dev-user", name: "Demo user", email: "demo.user@example.com", role: "admin", status: "active", lastActiveAt: "2026-09-30T11:58:00+05:30" },
  { userId: "u-principal", name: "Principal architect", email: "principal@studio8.example", role: "owner", status: "active", lastActiveAt: "2026-09-30T09:12:00+05:30" },
  { userId: "u-lead-phx", name: "Project lead (Phoenix)", email: "phoenix.lead@studio8.example", role: "member", status: "active", lastActiveAt: "2026-09-29T18:40:00+05:30" },
  { userId: "u-accounts", name: "Accounts", email: "accounts@studio8.example", role: "member", status: "active", lastActiveAt: "2026-09-30T10:02:00+05:30" },
  { userId: "u-site", name: "Site engineer", email: "site@studio8.example", role: "viewer", status: "active", lastActiveAt: "2026-09-28T19:20:00+05:30" },
  { userId: "u-consultant", name: "Structural consultant", email: "consultant@vertex.example", role: "guest", status: "invited" },
];

const audit: AuditEvent[] = [
  { id: "au-1", at: "2026-09-20T10:00:00+05:30", actor: "Principal architect", action: "source.connect", target: "Partners mailbox" },
  { id: "au-2", at: "2026-09-21T09:00:00+05:30", actor: "Principal architect", action: "source.connect", target: "Phoenix client group (export)" },
  { id: "au-3", at: "2026-07-30T13:05:00+05:30", actor: "Principal architect", action: "approval.approve", target: "Share Rev C structural drawings with the steel fabricator" },
];

export const STUDIO8_DATA: TenantDataset = {
  people,
  projects,
  budgetLines,
  txns,
  events,
  documents,
  decisions,
  approvals,
  sources,
  members,
  audit,
  evidence,
};
