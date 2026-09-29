# K!larity Enterprise Brain — Complete Screens & Views Catalog

> **Owner task**: EB-81 Research: chat and answer UI kits (with EB-23 Web UI shell and EB-50 Ask Brain UI)  
> **Status**: Master architectural specification  
> **Total Screens**: 54 screens (45 Tenant Web App + 9 Operator Admin Console)  
> **Built & Running Live**: 16 screens · **To Be Adapted from Rowboat**: 38 screens  

---

## 1. Executive Summary

This document specifies the complete visual and interactive screen inventory for the **K!larity Enterprise Brain**, combining the native AEC intelligence platform with the full communications, knowledge base, meeting intelligence, and file viewer components extracted from the upstream **Rowboat** architecture.

The platform is split into two independently deployable applications:
1. **Tenant Web Application (`apps/web` on `:3000`)**: 45 screens and views serving partners, project managers, engineers, contractors, and client guests.
2. **Operator Admin Console (`apps/admin` on `:3001`)**: 9 screens and views serving internal K!larity operations, DevOps, customer support, and system administrators.

---

## 2. Complete Master Table of Screens

| # | Screen / View | Route / Location | Rowboat Component / Origin | What It Does & Features on Screen (Detailed) | Target Role | Status |
|:---:|---|---|---|---|:---:|:---:|
| **1** | **Ask Brain Home & Thread** | `/ask` | `chat-sidebar.tsx` + `conversation.tsx` + `AskView.tsx` | **The Primary AI Cockpit**: Multi-turn query composer with quick prompt chips (*"Why is Phoenix over budget?"*, *"Overdue payments"*). Renders streaming answer cards with key figures, confidence score with rationale, "What I couldn't confirm" box, and numbered citation badges. Enter to send, Shift+Enter for newlines, sticky composer. | Everyone | **Built & Live** |
| **2** | **Evidence & Source Side-Sheet** | `/ask?source=...` | `document-viewer.tsx` + `SourcePanel.tsx` | **Evidence Verification Sheet**: Native slide-out panel that opens when clicking any citation chip. Displays verbatim passage, highlights exact supporting span in yellow, shows source timestamp in IST, author, and provides direct link to open the original Gmail/WhatsApp/Drive item. Esc traps/returns focus. | Everyone | **Built & Live** |
| **3** | **SSO Sign-In & Tenant Switcher** | `/login` | `onboarding/index.tsx` + `web-auth` | **Multi-Tenant Gateway**: Google Workspace / Keycloak SSO sign-in. Provides instantaneous workspace switching between active firms (e.g. *Studio 8 Hats*) and synthetic canary tenants (*Acme Builders*), plus capability-based role previewing (`Owner`, `Partner`, `Member`, `Viewer`, `Guest`). | Public | **Built & Live** |
| **4** | **Onboarding Wizard** | `/onboarding` | `onboarding/steps/*` (`welcome-step.tsx`, `connect-accounts-step.tsx`, `llm-setup-step.tsx`) | **First-Run Setup Flow**: Step-by-step walkthrough connecting firm data sources (Google Drive, Gmail, WhatsApp Cloud), running test connection, displaying initial sync progress bar, and seeding first sample queries. | Admin / Owner | **Next to Build** |
| **5** | **Communications & Email Feed** | `/communications` | `email-view.tsx` + `email-rail.tsx` | **In-App Unified Inbox**: Consolidates all incoming/outgoing project emails (Gmail/Outlook) and chat messages (WhatsApp/Slack). Left rail displays folders (Inbox, Starred, Sent, Project Tags). Filter bar by Project, Contractor, Vendor, or Category (*Tender*, *RFI*, *Change Order*, *Invoices*). Full-text & semantic keyword search. | Everyone | **To Adapt (Rowboat)** |
| **6** | **Email Thread & AI Extraction View** | `/communications/[threadId]` | `email-view.tsx` (Thread Reader & Extraction Pane) | **Two-Pane Conversation Detail**: Left pane shows formatted email thread with chronological replies and collapsible quotes. Right AI sidebar highlights: **Key Decisions** (with *"Send to Decision Log"* button), **Commitments & Deadlines**, and **Direct Attachment Chips**. | Everyone | **To Adapt (Rowboat)** |
| **7** | **In-App Email Composer & Reply** | Modal / Drawer | `email-view.tsx` (`EditorContent` / Tiptap Rich Text) | **Built-in Rich Email Composer**: Reply, Reply-All, Forward with rich text formatting (bold, italic, lists, quotes, hyperlinks), file attachment uploader, and AI draft completion assist. | Everyone | **To Adapt (Rowboat)** |
| **8** | **Knowledge Hub (Master View)** | `/knowledge` | `knowledge-view.tsx` | **Master Knowledge Management**: Three-way toggle between **Graph View**, **Structured Bases**, and **File Vault**. Shows total indexed chunks, storage volume, indexing pipeline health, and quick search across all firm archives. | Everyone | **To Adapt (Rowboat)** |
| **9** | **Knowledge File Vault & Tree** | `/knowledge/files` | `knowledge-view.tsx` (`files` mode) | **Hierarchical Document Manager**: Nested folder explorer with context menus (New Folder, Rename, Delete, Copy Path, Download, Reveal in OS). Drag-and-drop file upload zone supporting batch uploads with real-time parsing progress bars. | Everyone | **To Adapt (Rowboat)** |
| **10** | **Structured Bases / Data Tables** | `/knowledge/bases` | `bases-view.tsx` | **Airtable/Notion-Style Database Records**: Tabular database views of structured firm assets (BOQ Item Catalog, Contractor Master, Material Rate Cards, Past Legal Disputes). Allows filtering, sorting, column customization, and CSV export. | Everyone | **To Adapt (Rowboat)** |
| **11** | **Visual Knowledge Graph** | `/knowledge/graph` | `graph-view.tsx` | **Interactive Visual Ontology Network**: 2D/3D force-directed node-link graph visualizing relationships between Projects, Drawings, Contractors, Subcontracts, Payment Milestones, and Decisions. Clicking any node filters the side-panel to its connected evidence. | Everyone | **To Adapt (Rowboat)** |
| **12** | **Projects Fleet Overview** | `/projects` | `projects-rail.tsx` + `projects/page.tsx` | **Portfolio Dashboard**: Card grid of all active construction projects. Badges for project health (*On Track*, *At Risk*, *Off Track*), budget variance meter, target completion date, active team lead, and open risk counter. | Everyone | **Built (Design Active)** |
| **13** | **Project Detail Hub** | `/projects/[id]` | `projects-rail.tsx` + `project-view` | **Dedicated Project Cockpit**: Tabbed workspace with: (1) Milestone Timeline, (2) Budget vs. Actual breakdown, (3) Drawing Revision Ledger, (4) Project Team & Contractor Directory, and (5) Project-scoped Ask Brain composer. | Everyone | **Built (Design Active)** |
| **14** | **Decisions Review Queue & Log** | `/decisions` | `components/decisions/DecisionsView.tsx` | **Two-Tier Decision Ledger**: Top pane displays AI-discovered draft decisions extracted from email/chat with **Confirm**, **Edit**, or **Reject** actions (audited). Bottom pane displays chronological confirmed decision log with provenance links. | Everyone | **Built & Live** |
| **15** | **Document & Drawing Vault** | `/documents` | `components/documents/DocumentsView.tsx` | **Drawing Sheet & Spec Search**: Dedicated filterable document catalog. Shows latest revision badges (`Rev C`, `Rev D`), file types (DWG, PDF, XLSX), extracted metadata tags, and one-click preview. | Everyone | **Built & Live** |
| **16** | **Finance & Cash Control** | `/finance` | `components/finance/FinanceView.tsx` | **Financial Health Dashboard**: Indian currency format (Lakhs / Crores). Displays Receivables Aging buckets (0-30, 31-60, 61-90, 90+ days), package-level budget overruns (Civil, MEP, Finishes), and automated margin leakage flags. | Owner / Partner | **Built & Live** |
| **17** | **Executive Briefing Cockpit** | `/executive` | `components/executive/ExecutiveView.tsx` | **2-Minute Partner Briefing**: Top KPI tiles (Cash, Overdue Receivables, High-Risk Projects, Pending Decisions) and an algorithmic "Attention Today" prioritized action list. Every number links directly to SQL ledger derivations. | Owner / Partner | **Built & Live** |
| **18** | **Action Approvals Queue** | `/approvals` | `components/approvals/ApprovalsView.tsx` | **Human-in-the-Loop Safeguard**: Approvals inbox for high-stakes AI-suggested actions (contractor payment reminders, variation claims, RFI replies). Single-click Approve / Reject with mandatory rejection reason and audit logging. | Everyone (Role Gated) | **Built & Live** |
| **19** | **Meetings & Calendar Hub** | `/meetings` | `meetings-view.tsx` | **Meeting Intelligence Hub**: Calendar view synced with Google/Outlook. Lists scheduled site coordination meetings, client briefings, and past call archives with one-click links to join or view transcripts. | Everyone | **To Adapt (Rowboat)** |
| **20** | **Meeting Dossier & Prep Brief** | `/meetings/[id]/prep` | `meetings-view.tsx` (Prep Note Panel) | **Automated Pre-Meeting Briefing**: AI compiles attendee bios, outstanding action items from previous meetings, pending approval requests, and relevant drawing revisions before the call starts. | Everyone | **To Adapt (Rowboat)** |
| **21** | **Live Meeting Notes & Transcription** | `/meetings/live` | `live-notes-view.tsx` | **Real-Time Note Taker**: In-call audio streaming and live transcription with automatic keyword extraction, action item flagging, and post-call instant summary generation. | Everyone | **To Adapt (Rowboat)** |
| **22** | **Embedded Video / Audio Call View** | `/meetings/call` | `video-call-view.tsx` | **In-App Call Screen**: Built-in video calling interface with participant tile grid, screen sharing for drawing review, live captions, and recording controls. | Everyone | **To Adapt (Rowboat)** |
| **23** | **Action Todos & Commitments Hub** | `/todos` | `todo-view.tsx` | **Extracted Action Items**: Unified todo list extracted across emails, meetings, and documents. Checkbox completion, assignees, deadline dates, and source citation chips. | Everyone | **To Adapt (Rowboat)** |
| **24** | **Background Agents & Jobs Monitor** | `/tasks` | `bg-tasks-view.tsx` | **Autonomous Agent Activity**: Displays running background jobs (nightly knowledge gardening, connector syncs, budget audits, document re-indexing) with status indicators, scheduled times, and execution duration. | Owner / Partner | **To Adapt (Rowboat)** |
| **25** | **Background Task Detail Inspector** | Modal / Drawer | `background-task-detail.tsx` | **Agent Run Inspector**: Terminal-style live log viewer showing step-by-step tool calls, tokens consumed, errors, and retry attempts for any background task. | Owner / Partner | **To Adapt (Rowboat)** |
| **26** | **Project Spaces & Channels Hub** | `/spaces` | `spaces-view.tsx` | **Team Working Channels**: Multi-space hub grouping discussions, documents, and agent runs around specific topics (e.g. `#phoenix-structural`, `#mep-coordination`). | Everyone | **To Adapt (Rowboat)** |
| **27** | **Space Discussion Feed** | `/spaces/[id]` | `space-discussions-view.tsx` | **Channel Chat**: Real-time team discussion with `@mentions`, document references, reaction emojis, and threaded replies. | Everyone | **To Adapt (Rowboat)** |
| **28** | **Space Pinned Assets & Files** | `/spaces/[id]/files` | `space-files-view.tsx` | **Working Set Document List**: Dedicated file tab inside a Space containing all contract drafts, BOQs, and revisions pinned to that discussion. | Everyone | **To Adapt (Rowboat)** |
| **29** | **Team Activity Stream** | `/activity` | `activity-view.tsx` | **Audit Stream**: Feed of firm-wide events showing recent uploads, confirmed decisions, approved actions, and sync milestones. | Everyone | **To Adapt (Rowboat)** |
| **30** | **Spreadsheet & BOQ Grid Viewer** | Modal / Route | `spreadsheet-file-viewer.tsx` | **Native Tabular Viewer**: In-app viewer for `.xlsx` and `.csv` files. Renders multi-sheet workbooks, formula cells, formatted currency, and freeze panes for Bills of Quantities (BOQs). | Everyone | **To Adapt (Rowboat)** |
| **31** | **PDF Document Viewer** | Modal / Route | `pdf-file-viewer.tsx` | **In-App PDF Reader**: High-performance PDF viewer with page thumbnail sidebar, search within document, text copy, and bounding box highlights for evidence. | Everyone | **To Adapt (Rowboat)** |
| **32** | **Word Document Viewer** | Modal / Route | `docx-file-viewer.tsx` | **Native `.docx` Reader**: Formatted viewer for contractual specifications, agreements, and scope documents without needing Microsoft Word installed. | Everyone | **To Adapt (Rowboat)** |
| **33** | **Presentation Slide Deck Editor** | Modal / Route | `DocumentFileViewer` + `pptx-editor.tsx` | **In-App Slide Deck Viewer**: Slide-by-slide viewer and editor for PowerPoint `.pptx` presentations, design pitches, and client decks. | Everyone | **To Adapt (Rowboat)** |
| **34** | **Site Photo & Image Viewer** | Modal / Route | `image-file-viewer.tsx` | **High-Res Image Viewer**: Fullscreen lightbox for site inspection photos, progress snapshots, and JPEG/PNG architectural renders with pan/zoom. | Everyone | **To Adapt (Rowboat)** |
| **35** | **Video Inspection Player** | Modal / Route | `video-file-viewer.tsx` | **Media Player**: In-app player for site drone flythroughs, walkthrough videos, and recorded client meetings. | Everyone | **To Adapt (Rowboat)** |
| **36** | **Voice Note & Audio Player** | Modal / Route | `audio-file-viewer.tsx` | **Audio Waveform Player**: Waveform player with speed toggle (1x, 1.5x, 2x) for WhatsApp voice messages, site memos, and recorded phone discussions. | Everyone | **To Adapt (Rowboat)** |
| **37** | **Code & Diff Inspector** | Modal / Route | `code/code-view.tsx` + `diff-viewer.tsx` | **Syntax Highlighting & Diff Viewer**: Side-by-side split diff viewer for configuration files, automation scripts, and JSON payloads. | Technical / Admin | **To Adapt (Rowboat)** |
| **38** | **App Store & Tool Catalog** | `/apps` | `apps/apps-view.tsx` + `catalog.tsx` | **Integration Directory**: App store showing available and installed connectors / MCP tools (Google Drive, Gmail, WhatsApp Cloud, Procore, Autodesk BIM 360). | Owner / Partner | **To Adapt (Rowboat)** |
| **39** | **App Detail & Connection Config** | `/apps/[id]` | `apps/app-detail.tsx` | **Connector Configuration**: Setup wizard for individual tools (OAuth grant status, API keys, webhook URLs, and sync scopes). | Owner / Partner | **To Adapt (Rowboat)** |
| **40** | **Session History & Chat Archive** | `/history` | `chat-history-view.tsx` | **Search History Archive**: Searchable chronological list of all previous Ask Brain sessions, allowing partners to reopen past questions and answers. | Everyone | **To Adapt (Rowboat)** |
| **41** | **Suggested Topics & Trends** | `/explore` | `suggested-topics-view.tsx` | **Proactive AI Discovery**: AI-generated insight cards highlighting emerging cost overruns, frequent drawing revision bottlenecks, or contractor disputes. | Everyone | **To Adapt (Rowboat)** |
| **42** | **Global Command Palette (⌘K)** | Overlay Dialog | `command-palette.tsx` | **Universal Quick Switcher**: Keyboard launcher to immediately jump to any project, drawing sheet, email thread, decision, or setting with fuzzy matching. | Everyone | **To Adapt (Rowboat)** |
| **43** | **Settings — Connected Sources** | `/settings/sources` | `settings-dialog.tsx` + `settings/page.tsx` | **Source Management**: Lists connected data sources, sync health, last cursor time, items seen, and manual sync trigger. | Owner / Partner | **Built (Design Active)** |
| **44** | **Settings — Members & Roles** | `/settings/members` | `settings-dialog.tsx` + `settings/page.tsx` | **Team RBAC**: User directory with role assignments (`Owner`, `Partner`, `Member`, `Viewer`, `Guest`) and OpenFGA permission sync. | Owner | **Built (Design Active)** |
| **45** | **Settings — Retention & Security** | `/settings/security` | `settings-dialog.tsx` + `settings/page.tsx` | **Compliance Controls**: Tenant retention policy configuration (90 days to 7 years), KMS encryption key status, and audit log exports. | Owner | **Built (Design Active)** |
| **46** | **Operator Login & Impersonation Gate** | `admin:3001/login` | `apps/admin/app/login` | **Operator Access Gate**: Mandatory MFA-gated sign-in enforcing audited 30-minute time-bound impersonation sessions for operator support. | Operator Admin | **Built & Live** |
| **47** | **Tenant Registry Fleet Overview** | `admin:3001/tenants` | `apps/admin/app/tenants` | **Multi-Tenant Control Plane**: Lists all tenant organizations, deployment cells, AWS regions (`ap-south-2`), monthly queries, and cost-to-serve. | Operator Admin | **Built & Live** |
| **48** | **Tenant Detail & Placement Inspector** | `admin:3001/tenants/[id]` | `apps/admin/app/tenants/[id]` | **Tenant Resource Placement**: Displays isolated S3 prefixes, KMS aliases, OpenSearch index aliases, Qdrant shards, and OpenFGA stores. | Operator Admin | **Built & Live** |
| **49** | **Ingestion Pipeline & Worker Health** | `admin:3001/sources-health` | `apps/admin/app/sources-health` | **Temporal Pipeline Ops**: Real-time worker monitoring, queue throughput, connector SLAs (5-min chat vs hourly files), and dead-letter counters. | Operator Admin | **Built & Live** |
| **50** | **Dead-Letter Queue (DLQ) Inspector** | `admin:3001/dead-letter` | `DeadLetterStore` + `dead-letter/page.tsx` | **Failure Triage Console**: Admin view of failed items in PostgreSQL `ingestion_dead_letter` table: stack traces, stage, attempt counts, and 1-click replay. | Operator Admin | **Built (Backend Live)** |
| **51** | **Audited Retrieval Test Console** | `admin:3001/retrieval` | `apps/admin/app/retrieval` | **Search Sandbox**: Test vector + keyword chunk ranking "as" specific user roles under time-bound audit logging to verify permission boundaries. | Operator Admin | **Built & Live** |
| **52** | **LLM Gateway & Budget Metering** | `admin:3001/gateway` | `services/llm-gateway` + `gateway/page.tsx` | **Cost Control Console**: Real-time spend per tenant against $500/mo cap, alias distribution (`fast`, `reason`, `embed`, `rerank`), and Langfuse trace links. | Operator Admin | **Built (Backend Live)** |
| **53** | **System Audit Trail Explorer** | `admin:3001/audit` | `apps/api/audit` + `audit/page.tsx` | **Compliance Audit Log**: Append-only audit record viewer displaying operator logins, tenant impersonations, and data modifications. | Operator Admin | **Built (Backend Live)** |
| **54** | **Cell & Cluster Infrastructure Health** | `admin:3001/infrastructure` | `apps/admin/app/infra` | **Infrastructure Ops**: Connection health for PostgreSQL pools, Qdrant cluster nodes, OpenSearch clusters, and Temporal worker processes. | Operator Admin | **Next to Build** |

---

## 3. Breakdown by Functional Workstream

### 3.1 In-App Email & Communications Hub (Screens 5, 6, 7)
- **Problem solved**: Construction partners receive change requests and approvals scattered across Gmail and WhatsApp. Leaving the app to check messages breaks context.
- **Adapted from Rowboat**: Direct integration of `email-view.tsx` and `email-rail.tsx`.
- **Key capability**: View the full email thread in-app while an AI sidebar automatically extracts:
  - Commitments with deadlines
  - Quantified variations (e.g. *"Rate approved at ₹420/sq.ft"*)
  - One-click button to push a verbal agreement directly to the **Decisions Log**.

### 3.2 Knowledge Base & Visual Graph (Screens 8, 9, 10, 11)
- **Problem solved**: Firm data is trapped in disorganized folder drives, while building codes (NBC 2016) and rate cards exist in PDFs.
- **Adapted from Rowboat**: `knowledge-view.tsx`, `bases-view.tsx`, and `graph-view.tsx`.
- **Key capability**:
  - Three-way view (Files, Bases, Graph).
  - Visual 2D/3D graph connecting contractors to subcontracts and drawings.
  - Notion-style database records for cataloging suppliers and material rates.

### 3.3 Meetings & Real-Time Intelligence (Screens 19, 20, 21, 22)
- **Problem solved**: Minutes of meetings (MoMs) are rarely recorded accurately or shared with site engineers promptly.
- **Adapted from Rowboat**: `meetings-view.tsx`, `live-notes-view.tsx`, and `video-call-view.tsx`.
- **Key capability**:
  - Automated pre-meeting briefing with attendee profiles and open drawing revisions.
  - Live in-call transcription with automated action item tagging.

### 3.4 In-App Document & Media Viewers (Screens 30 to 37)
- **Problem solved**: Users shouldn't have to download multi-megabyte Excel BOQs, CAD drawings, or Word specs to their local laptops.
- **Adapted from Rowboat**: Spreadsheet, PDF, DOCX, Presentation, Audio, and Video viewers.
- **Key capability**:
  - In-browser interactive spreadsheet viewer with formula evaluation and freeze panes.
  - Audio waveform player with speed adjustment for WhatsApp voice notes.

---

## 4. Current Implementation Status

| Application | Category | Total Screens | Built & Live Today | Ready to Adapt (Rowboat) |
|---|---|:---:|:---:|:---:|
| **Tenant Web App (`apps/web`)** | Core Brain AI & Cockpit | **4** | 3 | 1 |
| | Email & Communications Hub | **3** | 0 | 3 |
| | Knowledge Hub & Visual Graph | **4** | 0 | 4 |
| | Projects, Drawing Vault & Decisions | **4** | 3 | 1 |
| | Finance & Executive Cockpit | **3** | 3 | 0 |
| | Meetings & Live Audio Notes | **4** | 0 | 4 |
| | Tasks, Background Agents & Spaces | **7** | 0 | 7 |
| | File Viewers (BOQ, PDF, Word, Media) | **8** | 0 | 8 |
| | Apps, History & Command Palette (⌘K) | **5** | 0 | 5 |
| | Tenant Settings & Compliance | **3** | 3 | 0 |
| **Operator Admin (`apps/admin`)** | Fleet, Placement, DLQ & Control Plane | **9** | 4 | 5 |
| **TOTAL** | | **54** | **16 Screens Live** | **38 Screens to Adapt** |
