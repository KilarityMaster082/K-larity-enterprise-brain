# Handoff: Enterprise Brain (54 screens)

## Overview
UI mockups for K!larity Enterprise Brain: a permission-aware assistant that reads email, drawings, ledger, chat and calendar, answers with cited sources, and runs project, finance, decision, meeting, agent and operator-admin workflows. 54 screens in 8 groups, sourced from `docs/architecture/SCREENS_CATALOG.md` in the repo `KilarityMaster082/K-larity-enterprise-brain` (branch `dev`).

## About the Design Files
Files in `reference/` are **design references built in HTML** (Design Component files, `.dc.html`). They show intended look and behavior. They are **not production code**. Recreate them in the target codebase (`apps/web`, Next.js App Router, using `packages/ui`) with its established patterns and libraries. Open `reference/Enterprise Brain.dc.html` in a browser (keep `support.js` beside it) to browse all 54 screens from the left sidebar.

## Fidelity
**High-fidelity** for colour, type, card shapes, chart styles and motion. Recreate pixel-perfectly. Content is sample data (Phoenix, Banyan, Studio 8 Hats; amounts in ₹). Images, PDFs and video are striped placeholders to be replaced by real renderers.

## Structure of the reference
- `Enterprise Brain.dc.html`: shell (left screen index, icon rail, top bar, per-group "brief" metric row) and the screen list `S` with number, title, route, role, status. Main content is rendered at CSS `zoom:.74`; real implementation should use the already-shrunk sizes, not zoom.
- `EBCore` screens 1-4, 40-42 · `EBComms` 5-11 · `EBWork` 12-18 · `EBMeet` 19-23 · `EBAgents` 24-29 · `EBViewers` 30-37 · `EBApps` 38, 39, 43-45 · `EBAdmin` 46-54. Each takes a `screen` number prop and renders that screen's markup. Read the matching file for exact per-screen layout, copy and values.

## Screens (number, title, route, role, status)
- 1 Ask Brain Home & Thread /ask Everyone Built
- 2 Evidence & Source Side-Sheet /ask?source= Everyone Built
- 3 SSO Sign-In & Tenant Switcher /login Public Built
- 4 Onboarding Wizard /onboarding Admin/Owner Next
- 5 Communications & Email Feed /communications Everyone Adapt
- 6 Email Thread & AI Extraction /communications/[id] Everyone Adapt
- 7 Email Composer & Reply (drawer) Everyone Adapt
- 8 Knowledge Hub /knowledge Everyone Adapt
- 9 Knowledge File Vault /knowledge/files Everyone Adapt
- 10 Structured Bases /knowledge/bases Everyone Adapt
- 11 Visual Knowledge Graph /knowledge/graph Everyone Adapt
- 12 Projects Fleet Overview /projects Everyone Active
- 13 Project Detail Hub /projects/[id] Everyone Active
- 14 Decisions Queue & Log /decisions Everyone Built
- 15 Document & Drawing Vault /documents Everyone Built
- 16 Finance & Cash Control /finance Owner/Partner Built
- 17 Executive Briefing Cockpit /executive Owner/Partner Built
- 18 Action Approvals Queue /approvals Role gated Built
- 19 Meetings & Calendar Hub /meetings Everyone Adapt
- 20 Meeting Dossier & Prep Brief /meetings/[id]/prep Everyone Adapt
- 21 Live Notes & Transcription /meetings/live Everyone Adapt
- 22 Video/Audio Call View /meetings/call Everyone Adapt
- 23 Action Todos & Commitments /todos Everyone Adapt
- 24 Background Agents Monitor /tasks Owner/Partner Adapt
- 25 Agent Run Inspector (drawer) Owner/Partner Adapt
- 26 Spaces & Channels Hub /spaces Everyone Adapt
- 27 Space Discussion Feed /spaces/[id] Everyone Adapt
- 28 Space Pinned Files /spaces/[id]/files Everyone Adapt
- 29 Team Activity Stream /activity Everyone Adapt
- 30 Spreadsheet & BOQ Viewer (modal) Everyone Adapt
- 31 PDF Document Viewer (modal) Everyone Adapt
- 32 Word Document Viewer (modal) Everyone Adapt
- 33 Slide Deck Viewer (modal) Everyone Adapt
- 34 Site Photo Viewer (modal) Everyone Adapt
- 35 Video Inspection Player (modal) Everyone Adapt
- 36 Voice Note Player (modal) Everyone Adapt
- 37 Code & Diff Inspector (modal) Technical/Admin Adapt
- 38 App Store & Tool Catalog /apps Owner/Partner Adapt
- 39 App Detail & Connection /apps/[id] Owner/Partner Adapt
- 40 Session History & Chat Archive /history Everyone Adapt
- 41 Suggested Topics & Trends /explore Everyone Adapt
- 42 Global Command Palette ⌘K Everyone Adapt
- 43 Settings · Connected Sources /settings/sources Owner/Partner Active
- 44 Settings · Members & Roles /settings/members Owner Active
- 45 Settings · Retention & Security /settings/security Owner Active
- 46 Operator Login & Impersonation admin/login Operator Built
- 47 Tenant Registry Fleet admin/tenants Operator Built
- 48 Tenant Placement Inspector admin/tenants/[id] Operator Built
- 49 Ingestion Pipeline Health admin/sources-health Operator Built
- 50 Dead-Letter Queue Inspector admin/dead-letter Operator Backend
- 51 Audited Retrieval Console admin/retrieval Operator Built
- 52 LLM Gateway & Budget admin/gateway Operator Backend
- 53 System Audit Trail admin/audit Operator Backend
- 54 Cell & Cluster Health admin/infra Operator Next

## Shell layout
- Page background `#1b1b1b`. App frame: radius 34px, background `linear-gradient(135deg,#e8e2f0 0%,#e3e9f4 42%,#f3e6e4 100%)`, shadow `0 30px 80px rgba(0,0,0,.5)`.
- Left icon rail 74px wide, items 38px circles, 18px 1.7px-stroke icons. Active: bg `#0e0e0e`, icon white. Inactive: transparent, icon `#333`. Items: Ask Brain(1), Projects(12), Finance(16), Decisions(14), Documents(15), Executive(17), Approvals(18), Settings(43). User avatar "MK" 34px circle `#d2ff1f` at bottom.
- Top bar: route pill (mono 11px, white, pill), centre segmented period (Today / This Week / This Month / Reports; active pill `#0e0e0e` white text 600), tenant switcher pill "Studio 8 Hats ▾", ⌘K button 34px black circle.
- Screen header chips: "N / 54" black pill, title · role, status pill `#d2ff1f`.
- Group brief row: 4-column grid, gap 8px. Three pastel metric cards (radius 14, padding 9×12; label 10px/600, value 17px/600 tracking -.02em, note 9.5px, 54×26 sparkline drawn on load) plus one black "Live" card with 3 overlapping avatars (24px, -8px overlap), lime "Live" label and pulsing dot.
- Bento cards: radius ~14-22px, gap 8-10px, lime/black/pastel fills, dark-on-light text.

## Design Tokens
Colours: lime `#d2ff1f`; black `#0e0e0e`; ink `#1b1b1b`; sky `#c5effd`; lavender `#dcd3f8`; pink `#ffc9c9`; green `#c6e4c1`; cream `#fff4d6`; muted text `#5d5b66`; dark-surface text `#eee`/`#cfcfd6`/`#9a9aa4`/`#77777f`. (Reference images fixed these instead of the repo's orange.)
Type: Google Sans 400/500/600/700 (UI); JetBrains Mono 400/500 (routes, numbers, IDs). Sizes: 9-10px captions, 11-12.5px UI, 17px metric values, larger for hero numbers per screen.
Radius: 99px pills, 12-14px small cards, 22-34px large containers. Spacing: 8 / 10 / 12 / 14 / 24px.
Status colours: live = lime; overdue/failed = pink; pending = cream; healthy = green.

## Interactions & Motion (keyframes in the shell `<style>`)
`grow` bar scaleX 0→1; `rise` column scaleY; `pulse` 1.6s infinite (live dots, pods); `ring` expanding fade; `flow` dashed-line offset (graph edges); `float`; `spin`; `blink`; `wave` (waveforms); `fadeUp` .4s; `wedge` scale .4→1 (donut wedges); `drift`; `type` (typewriter). Respect `prefers-reduced-motion`.
Navigation: clicking a sidebar/rail item switches screen; selection persists (localStorage `eb_screen`). In the app each maps to the route above. Drawers/modals (7, 25, 30-37, 42) open over their parent screen.
Role gating: each screen lists the allowed role; hide nav and block routes accordingly.

## State & Data
Per screen: server data from existing APIs (threads, knowledge graph, projects, ledger, decisions, approvals, meetings, agent runs, tenants, DLQ, gateway spend, audit). Brain answers need streamed text with source citations. Shell state: active tenant, period filter, current user/role, command palette open. Sample values in the reference are placeholders only.

## Assets
- Logos: `packages/ui/brand/logo-on-dark.png`, `mark.png` (from the repo).
- Photos, PDF pages, video frames: striped placeholders, replace with real content.
- Reference images supplied by the user (colour, chart and layout style): `uploads/pasted-*.png`. Included in `reference/uploads/`.

## Suggested Claude Code workflow
1. Put this folder at the repo root and start Claude Code there.
2. First prompt: "Read design_handoff_enterprise_brain/README.md and the reference files. Implement the shell (rail, top bar, theme tokens in packages/ui) first, then screen 1."
3. Then one group per session: "Implement screens 12-18 from reference/EBWork.dc.html using existing components in packages/ui and the real data hooks."
4. Build shared primitives first: MetricCard, BentoCard, Pill, AvatarStack, Sparkline, DonutWedges, BarChart, StripedPlaceholder.
5. Compare each screen against the reference in a browser before moving on.

## Files
`reference/`: Enterprise Brain.dc.html, EBCore.dc.html, EBComms.dc.html, EBWork.dc.html, EBMeet.dc.html, EBAgents.dc.html, EBViewers.dc.html, EBApps.dc.html, EBAdmin.dc.html, support.js.
