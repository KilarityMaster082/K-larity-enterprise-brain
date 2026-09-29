# UI/UX research and design spec: K!larity Enterprise Brain

> Owner task: EB-81 Research: chat and answer UI kits (with EB-23 Web UI shell and EB-50 Ask Brain UI)
> Date: 30 Sep 2026 · Status: first pass. Stack decided; the brand palette is provisional until the founder signs it off.

This page records what we studied, what we decided, and how every screen of the Brain should behave. The
build that follows it is in `apps/web` (see §9).

## 1. What the UI has to do

The partners at Studio 8 will use the Brain to answer questions like "Why is Project Phoenix over budget?",
often from a phone on site. They will act on the answers, which means spending money or chasing a client. So
the UI has to make each answer **checkable in seconds**, not just readable.

### Design principles

| # | Principle | What it means on screen |
|---|---|---|
| P1 | **Evidence first** | Every claim has a numbered citation. A citation opens the exact passage it relies on, not only the document. |
| P2 | **Numbers from the ledger** | Figures show a "From ledger" badge naming the SQL query behind them (CLAUDE.md rule 3). The model never writes a number. |
| P3 | **Honest uncertainty** | Every answer has a "What I couldn't confirm" section. With too little evidence, the Brain says so and does not guess. |
| P4 | **Nothing leaves without a person** | Suggested actions only create drafts in Approvals (rule 10). The button says "Needs approval". |
| P5 | **Permission-aware, visibly** | The composer says only accessible sources are searched. The nav and pages follow the user's role, and the server enforces it. |
| P6 | **One tenant on screen** | Switching workspace resets every page. Synthetic or test tenants carry a badge. |
| P7 | **Calm and dense** | Quiet neutrals and one action colour. Tabular numbers, Indian formats (₹18.4 lakh, IST) and mobile layouts that are first-class. |
| P8 | **Accessible by default** | WCAG 2.1 AA contrast in light and dark. Full keyboard use, focus returned after dialogs close, reduced motion respected. |

## 2. Tools and products studied

Current versions and licences were checked with `npm view` on 30 Sep 2026. "Pattern only" means we use the
idea and copy no code or visual design.

| Tool / product | Licence | Strong at | What we take | Verdict |
|---|---|---|---|---|
| **assistant-ui** (0.15.22) | MIT | Headless Thread/Composer primitives, tool-call UI, branch switching | Composer behaviour (Enter to send, Shift+Enter for a newline, IME-safe) | **Not now.** Our answer is a structured card, not a chat transcript. Revisit for multi-turn threads. |
| **Vercel AI SDK** (`ai` 7.0.x) | Apache-2.0 | `streamObject` streams typed JSON; `useChat` | Stream the answer contract section by section | **Adopt when EB-47 streams** (server side). Needs rule-7 sign-off. |
| **CopilotKit** (1.75) | MIT | AG-UI protocol, shared agent state, human-in-the-loop interrupts | Approve/edit/reject interrupt pattern for Approvals | **Pattern.** Revisit with EB-66. |
| **LibreChat** | MIT | Conversation forking, artifacts, MCP tools | Fork-a-question idea for later | Pattern. |
| **Open WebUI** | BSD-3 plus branding clause | Citation popovers, knowledge-base RBAC | Nothing copied | Pattern only (branding clause). |
| **Onyx web UI** | MIT (ee excluded) | Inline numbered citations; a document sidebar splitting cited from other documents, with match highlights | Numbered chips, plus a side sheet that opens the source with the matched span highlighted | **Pattern adopted.** No code copied. |
| **Perplexity** | Proprietary | Ask → synthesized answer → inspect sources → dig further | A prominent numbered source list under each answer | Pattern. |
| **Glean** | Proprietary | Permission-aware enterprise search; the move from "ask" to "delegate" | Permission cue in the composer; delegation becomes Approvals | Pattern. |
| **Hebbia Matrix** | Proprietary, **patented** (US 12,393,788 "Matrix user interface for LLM-powered data analysis") | Documents × questions grid with cell-level citations | Nothing yet | **Legal review before** building any grid of prompts over documents (for example, comparing vendor quotations). |
| **Apache Superset** (embedded SDK) | Apache-2.0 | Embedded dashboards with guest tokens and RLS | Possible later for Finance | Decided in EB-82. |
| **Metabase** | AGPL + commercial | Question builder, auto dashboards | Nothing | Pattern only. |
| **Dify** | Modified Apache-2.0 | Workflow UI | **Nothing.** The licence bars copying its UI or interaction design. | Avoid. |

### Research findings that shaped the design

- **A wrong citation costs more than a missing one.** Studies show one valid citation earns as much trust as
  five, and an invalid citation erases the gain. So every citation must open the exact supporting span, and the
  UI never shows a citation it cannot open.
- **Show the work and the uncertainty.** Trust-focused AI UX guidance stresses confidence signals, visible
  reasoning and correction flows. That gives us the confidence badge with its reason, the "couldn't confirm"
  box, and feedback with reasons.
- **The shift toward delegation** (Glean and others): users increasingly assign goals, not questions. For us
  that becomes suggested actions that turn into approvable drafts, never direct side effects.

## 3. Decisions

| ID | Decision | Why |
|---|---|---|
| UI-1 | **Next.js 16 (App Router) + React 19 + TypeScript 5.9.** No component or CSS framework; design tokens in CSS custom properties; inline SVG icons. | Smallest licence surface (next, react, react-dom: MIT; TypeScript: Apache-2.0). Full control over accessibility. No Tailwind/shadcn/Radix to review yet. |
| UI-2 | **Pin Next 16.3.6**, not 16.3.7. | 16.3.7 was one day old. pnpm's minimum-release-age guard flagged it, and we keep the guard on rather than add exclusions. |
| UI-3 | **The answer is a structured card**, not free chat text. Sections: answer · key figures · why · risks · couldn't confirm · next steps · sources · feedback. | Mirrors the answer contract (EB-47); makes P1–P4 visible. |
| UI-4 | **Citations:** numbered chips inline, plus a source list. A chip opens a side sheet with the passage and the supporting span highlighted, and what it was used to support. | P1; the Onyx and Perplexity patterns. |
| UI-5 | **Figures:** a tile per figure with a "From ledger" badge; hovering shows the query name. | P2, rule 3. |
| UI-6 | **Insufficient evidence** gets its own card state: no figures, no guesses, tips on how to rephrase. | P3. |
| UI-7 | **Actions** create drafts for Approvals and show "Needs approval". | P4, rule 10. |
| UI-8 | **Tenant switch** is a server action that resets to Ask. In production it is a re-login into the chosen Keycloak organization. The client never chooses the tenant for data access. | P6, ADR-013. |
| UI-9 | **Nav filtered by role, and pages guarded on the server** (Finance and Executive: owner and partner; Settings: owner). | P5. |
| UI-10 | **Theme:** light and dark from tokens. The preference is kept in a cookie so the server renders it with no flash. | P8. |
| UI-11 | **Streaming:** for now, staged progress ("Understanding → Searching → Checking evidence"). Later, stream contract sections with the AI SDK. | Honest progress, without inventing a protocol before EB-47. |
| UI-12 | **Dev-only sign-in** until Keycloak is ready. It is disabled in production builds, and the fixture answers are refused in production. | Unblocks UI work without weakening production. |

## 4. Information architecture

| Section | Page | Who | Purpose |
|---|---|---|---|
| Brain | Ask Brain (home) | everyone | Ask, verify, act |
| Brain | Projects | everyone | Per-project timeline, people, drawings, decisions, budget vs actual |
| Brain | Finance | owner, partner | Cash, receivables, budget variance, leakage flags |
| Brain | Decisions | everyone | Review draft decisions; confirmed decision log |
| Brain | Documents | everyone | Find the latest revision of any document or drawing |
| Workspace | Executive | owner, partner | State of the firm in under two minutes |
| Workspace | Approvals | everyone (approve rights by role) | Drafts waiting for a person |
| Workspace | Settings | owner | Sources, members, retention |

The K!larity operator console (tenants, health, impersonation) is a separate app, `apps/admin` (EB-88).

## 5. Screen specifications

**Ask Brain.** The empty state has a heading, the composer and four suggested questions. After a question,
the answer thread uses a sticky composer.
- While working: three staged steps and skeleton lines.
- On error: an inline message with "Try again".
- A 401 sends the user to sign-in.
- Answers render as in UI-3.

**Source sheet.** A right-hand side sheet built on native `<dialog>`: Esc closes it, focus is trapped and
returns to the citation.
- **Header:** the source type, title, author, time in IST and project.
- **Body:** the passage with the supporting span highlighted, and the claims it supports.
- **Footer:** "Open in Gmail/WhatsApp/…" when the user may open the original.

**Projects (EB-54).** A list of projects with stage and health, then a project page containing:
- a timeline;
- people;
- the latest drawings, with a revision badge;
- open decisions;
- budget vs actual, from SQL;
- risks;
- an Ask box scoped to the project.

**Finance (EB-55).**
- Cash and receivables ageing.
- Variance per project and package.
- Overdue client payments.
- Leakage flags.

Every number drills down to its ledger rows and evidence.

**Decisions (EB-53).** A review queue of drafts (confirm, edit, reject) with the source messages, plus a
per-project decision log. Confirmed decisions answer "What did we decide…?" first.

**Documents (EB-57).** Search with filters for project, type, revision and date, and a preview with a summary
and extracted facts. Latest-revision badges on drawings.

**Executive (EB-60).** Tiles for cash, projects at risk, decisions waiting and overdue items, plus an
"attention today" list. Every tile drills down to evidence.

**Approvals (EB-66).** Pending drafts showing:
- who asked, and why;
- the evidence behind the draft;
- approve, edit or reject, each of which is audited.

**Settings.** Connected sources with sync health; members and roles; retention and export.

**States every page must design for:**
- loading (skeleton);
- empty (explain what will appear and why);
- error (retry);
- no access (explain; no data leaked);
- insufficient evidence;
- synthetic-tenant badge.

## 6. Visual language (provisional)

There is no K!larity brand guide yet, so these values are proposals for the founder to accept or replace.
Change them only in `apps/web/styles/tokens.css`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--brand` | #2B45D4 | #8199FF | Actions, current nav item, links |
| `--accent` | #E89A0C | #F5B43A | The "!" in K!larity; the edge of highlighted evidence |
| `--mark-bg` | #FFEFC2 | #4A3A12 | Highlighted evidence span |
| `--text` / `--text-2` / `--text-3` | #0F172A / #445066 / #5F6B80 | #E8ECF4 / #B0BACE / #95A0B8 | Body, secondary, muted (all AA on their surfaces) |
| `--ok` / `--warn` / `--danger` / `--info` | #157A3A / #A4560A / #B42318 / #1F5FBF | lighter variants | Confidence, risk and status |

- **Type:** the system UI font stack, so no web-font download. Sizes run from 12 to 28 px.
- **Radius:** 6, 10 and 14 px.
- **Layout:** sidebar 248 px, reading width 880 px, source sheet 440 px.

## 7. Component inventory

| Component | Path | Status |
|---|---|---|
| App shell: sidebar, tenant switcher, top bar, mobile drawer | `components/shell/AppShell.tsx` | built |
| Theme toggle | `components/shell/ThemeToggle.tsx` | built |
| Icons (inline SVG) | `components/ui/Icon.tsx` | built |
| Page placeholder, no-access state | `components/ui/PagePlaceholder.tsx` | built |
| Ask view: composer, progress, thread | `components/answer/AskView.tsx` | built |
| Answer card | `components/answer/AnswerCard.tsx` | built |
| Citation list | `components/citations/CitationList.tsx` | built |
| Source sheet | `components/sources/SourcePanel.tsx` | built |
| Feedback | `components/answer/Feedback.tsx` | built (dev: acknowledged, not stored) |
| Data table, filters, timeline, KPI tile, chart | — | to build with EB-54, EB-55, EB-57 and EB-60 |
| Command palette (⌘K) | — | proposed (new task) |

## 8. Open questions and risks

1. **Brand:** accept or replace the provisional palette and logo tile.
2. **Answer contract:** `apps/web/lib/contracts.ts` is the UI's proposal. EB-47 owns the schema, and the
   TypeScript types should be generated from it.
3. **The Hebbia patent** limits any documents × questions grid feature. It needs legal review first.
4. **Keycloak:** sign-in, organization claim and tenant switch are dev stand-ins until the SSO task lands.
5. **Languages:** Telugu and Hindi site terms appear in sources. UI localisation is not planned yet.

## 9. What is built (30 Sep 2026)

- `apps/web` runs on Next 16.3.6. `pnpm install`, then `pnpm web:dev`, then open http://localhost:3000.
- In development, sign in as the demo user and pick a workspace.
- **Built and working:**
  - the shell (EB-23): login, role-filtered nav, tenant switch, light/dark, mobile drawer;
  - the Ask Brain flow (EB-50) on fixture data: answer card, citations, source sheet, "From ledger" figures,
    insufficient-evidence state, feedback, approval-gated actions.
- **Other Brain pages:** designed empty states with server-side role guards. Their data comes with their own
  tasks.
- **Checked** with a scripted browser walkthrough at desktop and 390 px mobile, in light and dark:
  - citation → exact span;
  - Esc closes, and focus returns to the citation;
  - a partner is refused Settings;
  - a tenant switch resets the view;
  - no horizontal overflow on mobile;
  - no console errors.
  - `next build` and `tsc` pass.

## Sources

- [AI UX patterns: the complete playbook for 2026 (Lazarev)](https://www.lazarev.agency/articles/ai-ux-patterns)
- [UX patterns that increase trust in AI (Goji Labs)](https://gojilabs.com/blog/ux-patterns-that-increase-trust-in-ai/)
- [10 UX design patterns that improve AI accuracy and customer trust (CMSWire)](https://www.cmswire.com/digital-experience/10-ux-design-patterns-that-improve-ai-accuracy-and-customer-trust)
- [Designing for confident wrong answers](https://mspk.substack.com/p/designing-for-confident-wrong-answers)
- [Perplexity search interface strategy (Sacra)](https://sacra.com/chat/h/50b32b4b-fee0-4f3b-8fa1-e99a65e4b9e5/)
- [Glean vs Perplexity (Metavert)](https://metavert.io/glean-vs-perplexity)
- [Hebbia (Wikipedia)](https://en.wikipedia.org/wiki/Hebbia) · [Matrix user interface patent US 12,393,788](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12393788) · [Hebbia design interview](https://doublediamondnyc.substack.com/p/arjun-mahesh-head-of-design-at-hebbia)
- Onyx web UI read locally at commit a18fc1a: `web/src/sections/document-sidebar/` (pattern only, not copied)
- Tool Borrow Register (Notion) entries for assistant-ui, Vercel AI SDK, CopilotKit, LibreChat, Open WebUI, Superset, Metabase and Dify
