// Owner task: EB-50 Ask Brain UI — DEMO FIXTURES for UI development only.
// Fictional project data shaped like the answer contract; served by app/api/ask in `next dev` until the
// context engine (EB-47) is reachable. Never shipped as real answers: the route refuses in production.
import { ANSWER_CONTRACT_VERSION, type AnswerContract, type Evidence } from "../contracts";

function ev(e: Omit<Evidence, "highlight"> & { quote: string }): Evidence {
  const start = e.excerpt.indexOf(e.quote);
  if (start < 0) throw new Error(`fixture ${e.id}: quote not found in excerpt`);
  const { quote, ...rest } = e;
  return { ...rest, highlight: { start, end: start + quote.length } };
}

const PHOENIX_EVIDENCE: Evidence[] = [
  ev({
    id: "e1",
    sourceType: "sheet",
    title: "Phoenix — Budget vs Actual (Finance ledger)",
    project: "Project Phoenix",
    occurredAt: "2026-09-28T18:30:00+05:30",
    excerpt:
      "Approved budget: ₹1,53,00,000. Committed + forecast to complete: ₹1,71,40,000. Variance: ₹18,40,000 (12.0%). Largest movements: Facade (+₹9,20,000), Structural steel (+₹6,10,000), Site labour (+₹3,10,000).",
    quote: "Variance: ₹18,40,000 (12.0%)",
  }),
  ev({
    id: "e2",
    sourceType: "whatsapp",
    title: "Phoenix client group",
    author: "Client representative",
    project: "Project Phoenix",
    occurredAt: "2026-08-12T11:04:00+05:30",
    excerpt:
      "Saw the HPL samples at site today. We prefer the HPL panels over ACP for the front facade even if it costs more — please go ahead and update the drawings.",
    quote: "We prefer the HPL panels over ACP for the front facade even if it costs more",
  }),
  ev({
    id: "e3",
    sourceType: "email",
    title: "Revised quotation — facade cladding (HPL)",
    author: "Facade vendor",
    project: "Project Phoenix",
    occurredAt: "2026-08-19T16:20:00+05:30",
    excerpt:
      "As discussed, switching the front facade from ACP to HPL changes the cladding package from ₹14,80,000 to ₹24,00,000 including fixing system. Validity 30 days.",
    quote: "from ₹14,80,000 to ₹24,00,000",
  }),
  ev({
    id: "e4",
    sourceType: "drawing",
    title: "PHX-STR-204 Rev C (GFC) — transfer beam",
    author: "Structural consultant",
    project: "Project Phoenix",
    occurredAt: "2026-07-30T10:00:00+05:30",
    excerpt:
      "Rev C: transfer beam at level 2 revised from RCC to steel section ISMB 600 following the column shift. Supersedes Rev B.",
    quote: "revised from RCC to steel section ISMB 600",
  }),
  ev({
    id: "e5",
    sourceType: "email",
    title: "Site update — week 36",
    author: "Site engineer",
    project: "Project Phoenix",
    occurredAt: "2026-09-06T19:12:00+05:30",
    excerpt:
      "Steel delivery slipped by 3 weeks; masonry and MEP crews were retained on site to hold the schedule, adding labour cost for the period.",
    quote: "Steel delivery slipped by 3 weeks",
  }),
  ev({
    id: "e6",
    sourceType: "document",
    title: "Variation order VO-07 (draft, unsigned)",
    project: "Project Phoenix",
    occurredAt: "2026-09-02T12:00:00+05:30",
    excerpt:
      "VO-07: Facade material change ACP → HPL. Amount ₹9,20,000. Status: sent to client for signature. Signature: pending.",
    quote: "Signature: pending",
  }),
];

const PHOENIX: Omit<AnswerContract, "question" | "generatedAt"> = {
  version: ANSWER_CONTRACT_VERSION,
  status: "answered",
  answer: [
    { text: "Project Phoenix is ₹18.4 lakh (12%) over its approved budget.", evidenceIds: ["e1"] },
    {
      text: " Half of that comes from the client's switch from ACP to HPL on the front facade,",
      evidenceIds: ["e2", "e3"],
    },
    {
      text: " a third from the steel transfer beam added in the Rev C structural drawings,",
      evidenceIds: ["e4"],
    },
    { text: " and the rest from labour kept on site while steel delivery slipped.", evidenceIds: ["e5"] },
    {
      text: " The facade change is not yet billable: its variation order is still unsigned.",
      evidenceIds: ["e6"],
    },
  ],
  facts: [
    {
      id: "f1",
      text: "Budget variance",
      evidenceIds: ["e1"],
      figure: { amount: 1840000, currency: "INR", origin: "sql", query: "finance.project_variance" },
    },
    {
      id: "f2",
      text: "Facade (ACP → HPL)",
      evidenceIds: ["e1", "e3"],
      figure: { amount: 920000, currency: "INR", origin: "sql", query: "finance.variance_by_package" },
    },
    {
      id: "f3",
      text: "Structural steel (Rev C)",
      evidenceIds: ["e1", "e4"],
      figure: { amount: 610000, currency: "INR", origin: "sql", query: "finance.variance_by_package" },
    },
    {
      id: "f4",
      text: "Site labour (steel delay)",
      evidenceIds: ["e1", "e5"],
      figure: { amount: 310000, currency: "INR", origin: "sql", query: "finance.variance_by_package" },
    },
  ],
  causes: [
    { id: "c1", text: "Client approved HPL facade panels over ACP on 12 Aug.", evidenceIds: ["e2", "e3"] },
    { id: "c2", text: "GFC Rev C replaced the RCC transfer beam with a steel section.", evidenceIds: ["e4"] },
    { id: "c3", text: "Steel delivery slipped 3 weeks; crews were retained.", evidenceIds: ["e5"] },
  ],
  risks: [
    {
      id: "r1",
      text: "₹9.2 lakh facade variation is unrecoverable until VO-07 is signed.",
      severity: "high",
      evidenceIds: ["e6"],
    },
  ],
  unknowns: [
    "Whether the Rev C steel change can be billed to the client — no variation order or client message found.",
    "Labour cost after 30 Sep is not in the ledger yet.",
  ],
  confidence: {
    level: "high",
    reason: "All figures come from the finance ledger and every cause has a direct source.",
  },
  actions: [
    { id: "a1", label: "Draft a reminder to the client to sign VO-07", kind: "draft_message", requiresApproval: true },
    { id: "a2", label: "Create a task: raise a variation for the Rev C steel", kind: "create_task", requiresApproval: true },
  ],
  evidence: PHOENIX_EVIDENCE,
};

const INSUFFICIENT: Omit<AnswerContract, "question" | "generatedAt"> = {
  version: ANSWER_CONTRACT_VERSION,
  status: "insufficient_evidence",
  answer: [
    {
      text: "I couldn't find enough in your connected sources to answer this reliably, so I won't guess.",
    },
  ],
  facts: [],
  causes: [],
  risks: [],
  unknowns: [
    "No messages, emails, documents or ledger rows matched this question closely enough.",
    "Try naming the project, person or document, or ask an admin whether the right source is connected.",
  ],
  confidence: { level: "low", reason: "No supporting evidence found." },
  actions: [],
  evidence: [],
};

const NO_SOURCES: Omit<AnswerContract, "question" | "generatedAt"> = {
  ...INSUFFICIENT,
  answer: [{ text: "This workspace has no connected sources yet, so there is nothing to answer from." }],
  unknowns: ["Connect Gmail, Google Drive, Sheets or WhatsApp in Settings → Sources."],
  confidence: { level: "low", reason: "No sources connected." },
};

export const SUGGESTED_QUESTIONS = [
  "Why is Project Phoenix over budget?",
  "What did we decide about the Phoenix facade?",
  "What changed on Phoenix this week?",
  "Which client payments are overdue?",
];

export function demoAnswer(question: string, tenantSlug: string): AnswerContract {
  const now = new Date().toISOString();
  const q = question.toLowerCase();
  const base =
    tenantSlug !== "studio8"
      ? NO_SOURCES
      : q.includes("phoenix") && (q.includes("budget") || q.includes("cost") || q.includes("over"))
        ? PHOENIX
        : INSUFFICIENT;
  return { ...base, question, generatedAt: now };
}
