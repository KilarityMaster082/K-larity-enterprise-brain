# K!larity Enterprise Brain — Code Placement Rules

This repository mirrors the Notion Tasks database. Do not invent new top-level feature folders when an existing repo path applies.

## Architecture boundaries
- apps/web: user-facing Brain UI only.
- apps/admin: K!larity operator/admin UI only.
- apps/api: HTTP/API composition, auth middleware, tenant context and audit integration.
- services/ingestion: source connectors and durable ingestion workflows.
- services/normalization: parsing, OCR, chunking and provenance.
- services/context-engine: proprietary query understanding, permission filtering, retrieval, reranking, traversal, compression, reasoning, verification and routing.
- services/entity-resolution: canonical identity/entity matching.
- services/knowledge-graph: graph/fact/event construction.
- services/memory: Decision Memory.
- services/llm-gateway: the only application-facing LLM gateway.
- packages: reusable contracts, SDKs and cross-service libraries; no tenant-specific business logic.
- packs/aec: AEC-specific configuration and extractors; core must run with this disabled.
- agents: bounded agent definitions; no unrestricted super-agent.
- db: migrations, RLS policies, views and seed/control schemas.
- deploy: local/prod infrastructure configuration.
- docs: research, governance, customer and architecture documentation.
- services/evaluation: quality, leakage and security gates.

## Notion phase mapping
EB2 / Phase 2 -> services/ingestion, services/normalization, context-engine/indexing, knowledge-graph event extraction.
EB3 / Phase 3 -> services/context-engine, services/entity-resolution, packages/permissions, packages/schemas, evidence verification.
EB4 / Phase 4 -> packages/ontology, services/memory, apps/web/app/projects, apps/web/app/finance, apps/web/app/decisions, apps/web/app/documents, services/signals.

## Mandatory rules
1. tenant_id is required at every data boundary.
2. Permissions are checked before retrieval and again before rendering sensitive evidence.
3. Numbers come from SQL, not free-form model output.
4. Answers require evidence/citations.
5. Secrets never live in source files.
6. AEC/customer configuration belongs in packs/aec or docs/customer, not core.
7. New dependencies require licence review and CI approval.
8. Prefer existing packages/services over duplicate helpers.
9. Keep interfaces typed and versioned.
10. Do not add automation side effects without an approval model.
