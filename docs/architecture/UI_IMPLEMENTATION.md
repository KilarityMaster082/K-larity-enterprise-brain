# UI implementation — the 54 screens

> **Owner task**: EB-23 Web UI shell (with EB-50 Ask Brain UI, EB-88 Tenant admin console, EB-98 UI tests)  
> **Spec**: [SCREENS_CATALOG.md](SCREENS_CATALOG.md) (what each screen does) and [design_handoff_enterprise_brain/](design_handoff_enterprise_brain/) (how it looks)  
> **Status**: all 54 screens are built. Two are previews (21, 22, see below). Data is development data until the API lands.

## Where things live

| Piece | Path |
|---|---|
| Design tokens and kit CSS (`eb-*` classes) | `packages/ui/src/styles/eb-tokens.css`, `eb.css` |
| Kit components (Bento, Pill, Metric, charts, graph, shell) | `packages/ui/src/eb/` |
| Tenant app (screens 1–45) | `apps/web/app/**`, registry in `apps/web/lib/screens.ts` |
| Operator console (screens 46–54) | `apps/admin/app/**`, registry in `apps/admin/lib/screens.ts` |
| Answer contract (schema + TypeScript mirror + golden fixtures) | `packages/schemas/answer_contract/`, `apps/web/lib/contracts.ts` |
| Finance views | `db/views/finance.sql`, `db/migrations/0005_finance_budget_lines.sql` |

Both registries are tested against `SCREENS_CATALOG.md` and against the route files on disk (`tests/screens.test.ts` in each app), so a screen cannot be dropped, renamed or left without a page unnoticed.

## Flows that cross screens

**Ask → answer → evidence (screens 1, 2).** `/ask` posts to `/api/ask`, which streams NDJSON events built from the canonical `AnswerContract` (version `1.1.0`). Every answer carries evidence; numbers carry `origin: "sql"`. A citation chip (`E1`, `E2`, …) stores the evidence in a per-tenant cache and sets `?source=<id>`. The Evidence Side-Sheet reads that cache or fetches `/api/evidence/[id]`, which re-checks tenant and role before it renders (rule 2, second check). It shows the supporting span highlighted inside the excerpt, the page and Docling bounding box or TableFormer cell range when the parser recorded one, and the source time in IST. `Evidence.locator` was added in contract `1.1.0`; the JSON schema and golden fixtures are regenerated with `UPDATE_FIXTURES=1 pnpm --filter @klarity/web test` and validated by `packages/schemas/tests/test_answer_contract_fixtures.py`.

**Finance and executive (16, 17).** Every rupee figure is a `SqlFigure` whose `query` names a reviewed view in `db/views/finance.sql` (`finance_txn`, `finance_variance_by_package`, `finance_project_summary`, `finance_leakage_flags`, and the receivables, payables and cash functions). All are `security_invoker`, so row-level security on the tenant-owned tables applies to the caller. `assertSqlFigure` refuses a figure without that origin. Amounts that come from an email or a decision are labelled "as quoted", never as ledger figures. `apps/web/tests/finance-sql.test.ts` writes `db/seed/finance_equivalence.json`; `packages/ontology/tests/test_finance_views.py` loads it into PostgreSQL when `KLARITY_TEST_PG_URL` is set, runs the views as the `NOBYPASSRLS` app role and compares them with the TypeScript derivations and with a second tenant for isolation. CI runs this in the `sql` job. Amounts are formatted in lakh and crore (`formatINRShort`, `formatINRCompact`, `formatINR`).

**Decisions (14).** Drafts extracted from email and meetings land in the triage queue. Confirm, Edit and Reject are server actions that check the role, write an audit event and never change the ledger. A decision becomes "decided" only when a person confirms it.

**Overlays.** The Evidence Side-Sheet (`?source=`), file viewers 30–37 (`?view=`), the agent run inspector (`?run=`) and the email composer (`?compose=`) live in the URL and are mounted once by `OverlayHost`, so they can be linked, reloaded and closed with Back. `GET /api/files/[id]` is tenant- and role-checked; currency columns and money facts are hidden from roles without `finance.view`; code files need `code.view`.

**Operator console (46–54).** Tenant content is hidden until an operator starts an audited view of one tenant (reason of at least 10 characters, 30 minutes, start and end audited). The retrieval console applies the permission filter before scoring, then shows the query plan with timings: BM25 (k1 1.5, b 0.75), reciprocal-rank fusion (k 60, weights from `services/context-engine/retrieve.py`), and the rerank step against its 400 ms p95 SLA. Dead-letter replay reuses the item's idempotency key, needs a reason, refuses suspended tenants and sources waiting for re-authorisation, and is audited. Gateway spend is shown against the USD 500 monthly cap with the 85 % alert; a cap change is audited.

## Deliberate differences from the design handoff

| Area | What the handoff draws | What is built, and why |
|---|---|---|
| Scale | Frames are drawn at CSS `zoom: .74` | No `zoom` anywhere. Geometry is pre-shrunk by 0.74 and the type scale never drops below 10 px, so text stays legible and focus rings, zoom and screen readers behave. |
| Theme | Light and dark | Light skin only. The dark theme and its toggle were removed; legacy components are remapped to the lime palette by `data-skin="eb"`. Contrast is enforced by `packages/ui/tests/eb-contrast.test.ts` (one token, `--eb-muted-2`, was darkened to pass). |
| Fonts | Google Sans and JetBrains Mono | The stacks name them with `local()` and system fallbacks; nothing is fetched from a font CDN, because a new external dependency needs licence review and CI approval (rule 7). Loading them is a one-line change once approved. |
| Period control | Shown in the top bar | Shown only on screens with a time window (`PERIOD_ROUTES` in `apps/web/lib/period.ts`); elsewhere it would be a control that does nothing. |
| Knowledge graph | 3-D scene | A perspective tilt of the 2-D graph, with keyboard access and a list alternative. |
| Live notes (21), call view (22) | Live transcription and video | **Previews.** They replay recorded segments and show the layout; there is no microphone, camera or transcription service connected. The crumb says "Preview". |
| File vault (9) | Download and "Reveal in OS" | Omitted on the web. The development data layer does not keep file bytes, so uploads are recorded and listed but not stored. |
| Media viewers (34–36) | Real image, video, audio | The stage is a labelled placeholder; chapters, captions and the transcript (what the Brain indexes) are real and drive the timeline. |
| Sign-in (3, 46) | SSO (and MFA for operators) | Development sign-in only in `next dev`. Production uses OIDC (web) and the operator Keycloak realm with MFA (admin), which are not configured in this repository, so production sign-in fails closed. |

## What is development data

* `apps/web/lib/data/seed-*.ts` and `apps/admin/lib/data.ts`, `lib/ops.ts` hold seeded, in-memory data that resets with the server. Shapes follow the real tables (`ingestion_dead_letter`, the LLM gateway config) so they can be swapped for API calls.
* The dense (vector) channel of the retrieval console is reported as unavailable; the rerank step is a lexical stand-in and says so.
* Infrastructure health (54) and gateway usage (52) are seeded values. The roll-up rules (`cellHealth`, `budgetState`) are real and tested.
* Langfuse links appear only when `LANGFUSE_BASE_URL` is set.

## Running and checking

```
pnpm install
pnpm --filter @klarity/web dev      # http://localhost:3000  (demo sign-in)
pnpm --filter @klarity/admin dev    # http://localhost:3001  (demo operator)
make governance                     # structure, tenant-scope, borrow-map checks
make test                           # Python tests
make test-web                       # web, admin and ui unit tests, client-bundle leak check
python apps/web/e2e/smoke.py        # browser smoke over all 54 screens (needs Playwright; not in CI)
```

Playwright is a local tool only. It is not a repository dependency and is not in CI until it passes licence review (rule 7).
