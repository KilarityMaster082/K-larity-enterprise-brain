// Owner task: EB-50 Ask Brain UI — DEVELOPMENT answer engine. A small rule-based stand-in for the context
// engine (EB-47) that composes answer contracts from the tenant's own data, so the UI can be built and tested
// against realistic, consistent answers. It follows the same rules the real engine must:
//   - figures come only from the ledger derivations (rule 3); the query result itself is a citable source;
//   - every claim cites evidence from this tenant (rule 4); anything unexplained goes to "couldn't confirm";
//   - finance answers need the finance permission (rule 2); nothing is sent, actions become approval drafts.
import { formatINR, formatINRShort, formatPercent } from "@klarity/ui/format";

import { ANSWER_CONTRACT_VERSION, type AnswerContract, type Claim, type Evidence, type Risk, type Segment, type SuggestedAction } from "../contracts";
import { DEMO_NOW, leakageFlags, openReceivables, projectFinance } from "../data/derive";
import type { Project, TenantDataset } from "../data/types";

export const SUGGESTED_QUESTIONS = [
  "Why is Project Phoenix over budget?",
  "Which client payments are overdue?",
  "What did we decide about the Phoenix facade?",
  "What changed on Marigold Clinic recently?",
  "What is the latest structural drawing for Phoenix?",
];

type Body = Omit<AnswerContract, "question" | "generatedAt" | "version" | "summary" | "conflicts"> & { summary?: string; conflicts?: string[] };

export interface AskOptions {
  projectId?: string;
  canSeeFinance: boolean;
  hasSyncedSource: boolean;
  /** Clock override so tests and fixtures are deterministic. */
  now?: Date;
}

const STOP = new Set(["what", "which", "why", "the", "is", "are", "was", "did", "we", "about", "for", "on", "of", "a", "an", "to", "our", "and", "in", "with", "how", "much", "has", "have", "latest", "recently", "project", "this", "week"]);

function words(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

export function findProject(ds: TenantDataset, question: string, scopeId?: string): Project | undefined {
  if (scopeId) {
    const p = ds.projects.find((x) => x.projectId === scopeId);
    if (p) return p;
  }
  const q = question.toLowerCase();
  return ds.projects.find(
    (p) => q.includes(p.name.toLowerCase()) || q.includes(p.projectId) || new RegExp(`\\b${p.code.toLowerCase()}\\b`).test(q) || p.name.toLowerCase().split(" ").some((w) => w.length > 4 && q.includes(w)),
  );
}

function empty(text: string, unknowns: string[], reason: string, status: AnswerContract["status"] = "insufficient_evidence"): Body {
  return { status, answer: [{ text }], facts: [], causes: [], risks: [], unknowns, confidence: { level: "low", reason }, actions: [], evidence: [] };
}

function pickEvidence(ds: TenantDataset, ids: string[], extra: Evidence[] = []): Evidence[] {
  const byId = new Map([...ds.evidence, ...extra].map((e) => [e.id, e]));
  const seen = new Set<string>();
  const out: Evidence[] = [];
  for (const id of ids) {
    const e = byId.get(id);
    if (e && !seen.has(id)) {
      seen.add(id);
      out.push(e);
    }
  }
  return out;
}

/** The ledger query result as a citable source (what the SQL view returned). */
function ledgerEvidence(id: string, title: string, lines: string[], highlightLine: number, project?: string): Evidence {
  const excerpt = lines.join(" · ");
  const quote = lines[highlightLine]!;
  const start = excerpt.indexOf(quote);
  return { id, sourceType: "sql", title, excerpt, highlight: { start, end: start + quote.length }, project, author: "Finance ledger (SQL)", occurredAt: DEMO_NOW.toISOString() };
}

// ---------------------------------------------------------------- intents
function budgetAnswer(ds: TenantDataset, p: Project): Body {
  const fin = projectFinance(ds, p.projectId);
  const over = fin.lines.filter((l) => l.overrun > 0).sort((a, b) => b.overrun - a.overrun);
  const ledgerId = `q-variance-${p.projectId}`;
  const ledger = ledgerEvidence(
    ledgerId,
    `finance.variance_by_package — ${p.name}`,
    [
      `Approved budget ${formatINR(fin.budget)}`,
      `Forecast at completion ${formatINR(fin.forecast)}`,
      `Over budget ${formatINR(fin.overrun)} (${formatPercent(fin.overrunPct)})`,
      ...fin.lines.map((l) => `${l.package}: budget ${formatINR(l.budget)}, committed ${formatINR(l.committed)}`),
    ],
    2,
    p.name,
  );

  if (!over.length) {
    return {
      status: "answered",
      answer: [{ text: `${p.name} is within its approved budget: forecast ${formatINRShort(fin.forecast)} against ${formatINRShort(fin.budget)}.`, evidenceIds: [ledgerId] }],
      facts: [{ id: "f1", text: "Forecast at completion", evidenceIds: [ledgerId], figure: { amount: fin.forecast, currency: "INR", origin: "sql", query: "finance.variance_by_package" } }],
      causes: [],
      risks: [],
      unknowns: ["Costs not yet invoiced are not in the ledger."],
      confidence: { level: "high", reason: "Computed from the finance ledger." },
      actions: [],
      evidence: [ledger],
    };
  }

  const flags = leakageFlags(ds).filter((f) => f.projectId === p.projectId);
  const segments: Segment[] = [
    { text: `${p.name} is ${formatINRShort(fin.overrun)} (${formatPercent(fin.overrunPct, 0)}) over its approved budget of ${formatINRShort(fin.budget)}.`, evidenceIds: [ledgerId] },
  ];
  const facts: Claim[] = [
    { id: "f-total", text: "Over budget", evidenceIds: [ledgerId], figure: { amount: fin.overrun, currency: "INR", origin: "sql", query: "finance.variance_by_package" } },
  ];
  const causes: Claim[] = [];
  const unknowns: string[] = [];
  const ids: string[] = [];
  let drafts = 0;

  over.forEach((l, i) => {
    const txEvidence = l.txnIds.map((t) => `ev-${t}`);
    const decision = ds.decisions.find((d) => d.projectId === p.projectId && d.costImpact === l.overrun && d.status !== "revoked" && d.status !== "superseded");
    const cite = decision ? decision.evidenceIds : txEvidence;
    ids.push(...cite, ...txEvidence);
    facts.push({ id: `f-${i}`, text: l.package, evidenceIds: txEvidence, figure: { amount: l.overrun, currency: "INR", origin: "sql", query: "finance.variance_by_package" } });
    const share = l.overrun / fin.overrun;
    const shareText = share >= 0.45 && share <= 0.55 ? "Half" : share > 0.55 ? "Most" : share >= 0.3 ? "About a third" : "The rest";
    if (decision) {
      if (decision.status === "proposed") drafts++;
      segments.push({ text: ` ${shareText} (${formatINRShort(l.overrun)}, ${l.package.toLowerCase()}) comes from “${decision.title}”${decision.status === "proposed" ? " — a draft decision not yet confirmed" : ""}.`, evidenceIds: cite });
      causes.push({ id: `c-${i}`, text: `${decision.title}${decision.status === "proposed" ? " (draft, not yet confirmed)" : ""}.`, evidenceIds: decision.evidenceIds });
    } else {
      segments.push({ text: ` ${shareText} (${formatINRShort(l.overrun)}) is extra ${l.package.toLowerCase()} cost.`, evidenceIds: txEvidence });
      unknowns.push(`Why ${l.package.toLowerCase()} went over budget — no decision or message explains the extra ${formatINRShort(l.overrun)}.`);
    }
  });

  const risks: Risk[] = [];
  const actions: SuggestedAction[] = [];
  for (const f of flags) {
    ids.push(...f.evidenceIds);
    if (f.kind === "unsigned_variation") {
      segments.push({ text: ` ${f.title.replace(/ is unsigned$/, "")} is not yet billable: it is still unsigned.`, evidenceIds: f.evidenceIds });
      risks.push({ id: `r-${f.id}`, text: `${formatINRShort(f.amount)} cannot be billed until the variation is signed.`, severity: "high", evidenceIds: f.evidenceIds });
      actions.push({
        id: `a-${f.id}`,
        label: "Draft a reminder to the client to sign the variation",
        kind: "draft_message",
        requiresApproval: true,
        draft: {
          title: `Reminder to ${p.client}: please sign the pending variation`,
          body: `Dear ${p.client},\n\nThe variation for ${p.name} (${formatINR(f.amount)}) was sent for signature and is still pending. Could you sign it this week so we can include it in the next bill?\n\nRegards,\nStudio team`,
          reason: `${f.title}; the work is already under way.`,
          evidenceIds: f.evidenceIds,
          projectId: p.projectId,
        },
      });
    } else if (f.kind === "cost_not_billed") {
      risks.push({ id: `r-${f.id}`, text: `${f.title} (${formatINRShort(f.amount)}).`, severity: "medium", evidenceIds: f.evidenceIds });
      unknowns.push(`Whether the ${formatINRShort(f.amount)} change order can be billed to the client — no client variation found.`);
      actions.push({
        id: `a-${f.id}`,
        label: "Create a task: raise a client variation for this change",
        kind: "create_task",
        requiresApproval: true,
        draft: {
          title: `Raise a client variation for ${f.title.replace("Change order ", "").replace(" not passed to the client", "")}`,
          body: `Prepare a variation for ${p.client} covering ${formatINR(f.amount)} (${f.detail}) and attach the supporting drawing.`,
          reason: f.detail,
          evidenceIds: f.evidenceIds,
          projectId: p.projectId,
        },
      });
    }
  }
  unknowns.push(`Costs incurred after ${DEMO_NOW.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} are not in the ledger yet.`);

  return {
    status: "answered",
    answer: segments,
    facts,
    causes,
    risks,
    unknowns,
    confidence: drafts
      ? { level: "medium", reason: "Figures come from the ledger; one cause rests on a draft decision that is not yet confirmed." }
      : unknowns.length > 1
        ? { level: "medium", reason: "Figures come from the ledger, but part of the overrun has no explanation in the sources." }
        : { level: "high", reason: "Every figure comes from the ledger and every cause has a direct source." },
    actions,
    evidence: [ledger, ...pickEvidence(ds, ids)],
  };
}

function receivablesAnswer(ds: TenantDataset, p?: Project): Body {
  const open = openReceivables(ds).filter((r) => r.daysOverdue > 0 && (!p || r.projectId === p.projectId));
  if (!open.length) {
    const none = ledgerEvidence("q-overdue", "finance.open_receivables — overdue", ["Overdue total ₹0", "No open invoice is past its due date"], 0, p?.name);
    return {
      status: "answered",
      answer: [{ text: p ? `Nothing is overdue from ${p.client}.` : "No client payments are overdue.", evidenceIds: ["q-overdue"] }],
      facts: [{ id: "f-total", text: "Overdue total", evidenceIds: ["q-overdue"], figure: { amount: 0, currency: "INR", origin: "sql", query: "finance.open_receivables" } }],
      causes: [],
      risks: [],
      unknowns: ["Payments received today may not be in the ledger until the next sync."],
      confidence: { level: "high", reason: "Checked every open invoice in the ledger." },
      actions: [],
      evidence: [none],
    };
  }
  const total = open.reduce((a, r) => a + r.amount, 0);
  const name = (id: string) => ds.projects.find((x) => x.projectId === id)?.name ?? id;
  const ledgerId = "q-overdue";
  const ledger = ledgerEvidence(
    ledgerId,
    "finance.open_receivables — overdue",
    [`Overdue total ${formatINR(total)}`, ...open.map((r) => `${r.txnRef} ${r.counterparty}: ${formatINR(r.amount)}, ${r.daysOverdue} days overdue`)],
    0,
  );
  const segments: Segment[] = [{ text: `${formatINRShort(total)} is overdue across ${open.length} invoice${open.length > 1 ? "s" : ""}.`, evidenceIds: [ledgerId] }];
  const facts: Claim[] = [{ id: "f-total", text: "Overdue total", evidenceIds: [ledgerId], figure: { amount: total, currency: "INR", origin: "sql", query: "finance.open_receivables" } }];
  const ids: string[] = [];
  const causes: Claim[] = [];
  const actions: SuggestedAction[] = [];
  open.forEach((r, i) => {
    const related = ds.events.filter((e) => e.projectId === r.projectId && e.eventType === "email" && e.evidenceId && e.title.toLowerCase().includes("payment")).map((e) => e.evidenceId!);
    ids.push(r.evidenceId, ...related);
    segments.push({ text: ` ${r.counterparty} owes ${formatINRShort(r.amount)} on ${r.txnRef} (${name(r.projectId)}), ${r.daysOverdue} days late.`, evidenceIds: [r.evidenceId] });
    facts.push({ id: `f-${i}`, text: `${r.txnRef} · ${r.counterparty}`, evidenceIds: [r.evidenceId], figure: { amount: r.amount, currency: "INR", origin: "sql", query: "finance.open_receivables" } });
    if (related.length) causes.push({ id: `c-${i}`, text: `${r.counterparty} said payment is delayed.`, evidenceIds: related });
    actions.push({
      id: `a-${r.txnId}`,
      label: `Draft a payment reminder to ${r.counterparty}`,
      kind: "draft_message",
      requiresApproval: true,
      draft: {
        title: `Payment reminder to ${r.counterparty} for ${r.txnRef}`,
        body: `Dear ${r.counterparty},\n\n${r.txnRef} (${formatINR(r.amount)}) was due on ${r.dueDate}. Could you confirm when the payment will be released?\n\nRegards,\nAccounts`,
        reason: `${r.txnRef} is ${r.daysOverdue} days overdue.`,
        evidenceIds: [r.evidenceId, ...related],
        projectId: r.projectId,
      },
    });
  });
  return {
    status: "answered",
    answer: segments,
    facts,
    causes,
    risks: open.filter((r) => r.daysOverdue > 30).map((r) => ({ id: `r-${r.txnId}`, text: `${r.txnRef} is more than 30 days overdue.`, severity: "high" as const, evidenceIds: [r.evidenceId] })),
    unknowns: ["Payments received today may not be in the ledger until the next sync."],
    confidence: { level: "high", reason: "Every amount comes from the ledger." },
    actions,
    evidence: [ledger, ...pickEvidence(ds, ids)],
  };
}

function decisionsAnswer(ds: TenantDataset, question: string, p?: Project): Body {
  const terms = words(question).filter((w) => !["decide", "decided", "decision", "decisions"].includes(w) && !(p && p.name.toLowerCase().includes(w)));
  const pool = ds.decisions.filter((d) => (!p || d.projectId === p.projectId) && d.status !== "revoked");
  const match = pool.filter((d) => !terms.length || terms.some((t) => `${d.title} ${d.description}`.toLowerCase().includes(t)));
  if (!match.length) {
    return empty(
      `I found no decision about that${p ? ` on ${p.name}` : ""}.`,
      ["No confirmed or draft decision matched. It may have been discussed in a source that is not connected."],
      "No matching decision in Decision Memory.",
    );
  }
  const order = { decided: 0, proposed: 1, superseded: 2, revoked: 3 } as const;
  match.sort((a, b) => order[a.status] - order[b.status] || (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""));
  const top = match[0]!;
  const segments: Segment[] = [];
  if (top.status === "decided") {
    const who = top.decidedBy ? `${top.decidedBy} decided` : top.reviewedBy ? `Confirmed by ${top.reviewedBy}` : "It was decided";
    segments.push({ text: `${who}: ${top.title}.`, evidenceIds: top.evidenceIds });
    if (top.description) segments.push({ text: ` ${top.description}`, evidenceIds: top.evidenceIds });
  } else {
    segments.push({ text: `There is no confirmed decision yet. A draft says: ${top.title}.`, evidenceIds: top.evidenceIds });
  }
  const history = match.filter((d) => d !== top && d.status === "superseded");
  for (const h of history) segments.push({ text: ` It replaced an earlier choice: ${h.title}.`, evidenceIds: h.evidenceIds });
  const ids = match.flatMap((d) => d.evidenceIds);
  return {
    status: "answered",
    answer: segments,
    facts: [{ id: "f-decision", text: top.status === "decided" ? `Decision: ${top.title}` : `Draft decision: ${top.title}`, evidenceIds: top.evidenceIds }],
    causes: top.rationale ? [{ id: "c-why", text: top.rationale, evidenceIds: top.evidenceIds }] : [],
    risks: [],
    unknowns: top.status === "proposed" ? ["This is a draft extracted from a message; a project lead has not confirmed it."] : [],
    confidence: top.status === "decided" ? { level: "high", reason: "Answered from a confirmed decision with its source." } : { level: "medium", reason: "Only a draft decision was found." },
    actions: [],
    evidence: pickEvidence(ds, ids),
  };
}

function changesAnswer(ds: TenantDataset, p?: Project): Body {
  const since = DEMO_NOW.getTime() - 21 * 864e5;
  const recent = ds.events
    .filter((e) => (!p || e.projectId === p.projectId) && new Date(e.occurredAt).getTime() >= since)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, 6);
  if (!recent.length) return empty(`Nothing new${p ? ` on ${p.name}` : ""} in the last three weeks.`, ["Only connected sources are searched, so a call or site visit nobody wrote down will not appear."], "No events in the period.");
  const name = (id: string) => ds.projects.find((x) => x.projectId === id)?.name ?? id;
  const segments: Segment[] = [{ text: `In the last three weeks${p ? ` on ${p.name}` : ""}:` }];
  for (const e of recent) {
    const when = new Date(e.occurredAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
    segments.push({ text: ` ${when} — ${e.title}${p ? "" : ` (${name(e.projectId)})`}.`, evidenceIds: e.evidenceId ? [e.evidenceId] : undefined });
  }
  return {
    status: "answered",
    answer: segments,
    facts: recent.filter((e) => e.evidenceId).map((e) => ({ id: `f-${e.eventId}`, text: e.title, evidenceIds: [e.evidenceId!] })),
    causes: [],
    risks: [],
    unknowns: ["Only connected sources are included; phone calls and site visits are not recorded unless someone writes them down."],
    confidence: { level: "high", reason: "Each change is taken from a dated source." },
    actions: [],
    evidence: pickEvidence(ds, recent.flatMap((e) => (e.evidenceId ? [e.evidenceId] : []))),
  };
}

function drawingAnswer(ds: TenantDataset, question: string, p?: Project): Body {
  const terms = words(question).filter((w) => !["drawing", "drawings", "revision", "rev", "sheet"].includes(w) && !(p && p.name.toLowerCase().includes(w)));
  const pool = ds.documents.filter((d) => d.docType === "drawing" && d.isLatest && (!p || d.projectId === p.projectId));
  const match = pool.filter((d) => !terms.length || terms.some((t) => `${d.title} ${d.series} ${d.summary}`.toLowerCase().includes(t.replace(/al$/, ""))));
  const hits = (match.length ? match : pool).slice(0, 3);
  if (!hits.length) return empty("I found no drawings for that.", ["No drawing matched. Check that the drawings folder is connected."], "No matching drawing.");
  const segments: Segment[] = hits.map((d, i) => ({
    text: `${i ? " " : ""}The latest ${d.series} (${d.title}) is Rev ${d.revision}, issued ${new Date(d.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}: ${d.summary}`,
    evidenceIds: [d.evidenceId],
  }));
  return {
    status: "answered",
    answer: segments,
    facts: hits.map((d) => ({ id: `f-${d.documentId}`, text: `${d.series} is at Rev ${d.revision}`, evidenceIds: [d.evidenceId] })),
    causes: [],
    risks: [],
    unknowns: match.length ? [] : ["No drawing matched every word, so these are the latest drawings for the project."],
    confidence: { level: match.length ? "high" : "medium", reason: "Revision taken from the drawing register." },
    actions: [{ id: "a-open", label: "Open in Documents", kind: "open_source", requiresApproval: false }],
    evidence: pickEvidence(ds, hits.map((d) => d.evidenceId)),
  };
}

// ---------------------------------------------------------------- classification
/** The label shown next to a question in Session History: its project, else the kind of question. */
export function topicOf(question: string, ds: TenantDataset, scopeId?: string): string {
  const p = findProject(ds, question, scopeId);
  if (p) return p.name;
  const q = question.toLowerCase();
  if (/(budget|overrun|cost|variance|overdue|owe|outstanding|receivable|unpaid|payment|collect)/.test(q)) return "Finance";
  if (/(decide|decided|decision|agreed|chose|choose|approved)/.test(q)) return "Decisions";
  if (/(drawing|revision|\brev\b|sheet|plan|elevation|layout)/.test(q)) return "Drawings";
  return "All";
}

// ---------------------------------------------------------------- entry point
/** First sentence of the answer, or "" when there is none: the contract's executive summary. */
function summaryOf(body: Body): string {
  const text = body.answer.map((s) => s.text).join("").trim();
  const end = text.search(/[.!?](\s|$)/);
  return end < 0 ? text : text.slice(0, end + 1);
}

function finish(meta: Pick<AnswerContract, "version" | "question" | "generatedAt">, body: Body): AnswerContract {
  const { summary, conflicts, ...rest } = body;
  return { ...meta, summary: summary ?? summaryOf(body), conflicts: conflicts ?? [], ...rest };
}

export function answerQuestion(question: string, ds: TenantDataset, opts: AskOptions): AnswerContract {
  const meta = { version: ANSWER_CONTRACT_VERSION, question, generatedAt: (opts.now ?? new Date()).toISOString() };
  if (!opts.hasSyncedSource) {
    return finish(meta, empty("This workspace has no synced sources yet, so there is nothing to answer from.", ["Connect Gmail, Google Drive, Sheets or a WhatsApp export in Settings → Sources."], "No sources connected."));
  }
  const q = question.toLowerCase();
  const p = findProject(ds, question, opts.projectId);
  const finance = /(budget|over ?spend|overrun|cost|variance|expensive|money)/.test(q);
  const receivable = /(overdue|owe|outstanding|receivable|unpaid|payment|collect)/.test(q);
  if ((finance || receivable) && !opts.canSeeFinance) {
    return finish(meta, empty("Budgets and billing are visible to partners and owners, so I can't answer this for your role.", ["Ask a partner, or ask an owner to change your role."], "Restricted by role.", "no_access"));
  }
  let body: Body;
  if (receivable) body = receivablesAnswer(ds, p);
  else if (finance && p) body = budgetAnswer(ds, p);
  else if (finance) body = empty("Which project do you mean? Name it, or ask from the project's page.", ds.projects.slice(0, 4).map((x) => `e.g. “Why is ${x.name} over budget?”`), "No project named.");
  else if (/(decide|decided|decision|agreed|chose|choose|approved)/.test(q)) body = decisionsAnswer(ds, question, p);
  else if (/(drawing|revision|\brev\b|sheet|plan|elevation|layout)/.test(q)) body = drawingAnswer(ds, question, p);
  else if (/(change|changed|new|update|happen|latest|recent)/.test(q)) body = changesAnswer(ds, p);
  else
    body = empty(
      "I couldn't find enough in your connected sources to answer this reliably, so I won't guess.",
      ["Try naming the project, person or document.", "Ask about budgets, payments, decisions, drawings or what changed recently."],
      "No supporting evidence found.",
    );
  return finish(meta, body);
}
