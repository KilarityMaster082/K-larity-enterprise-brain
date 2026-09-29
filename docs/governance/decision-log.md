# Decision Log

> Owner task: EB-1 Governance: RACI, decision log, weekly review  
> Canonical source: Notion Document Hub → [Decision Register & ADRs v1.1](https://app.notion.com/p/3eae3304343e81479b58cec5d41ec7da)

| Date | ID / Context | Decision | Rationale | Status |
|---|---|---|---|---|
| 2026-09-30 | EB-28 / D-01 | Sign off `pytest 8.3.3` (MIT) for Dev and CI | Required test framework; strictly scoped to development/CI execution under Rule 7. | Approved |
| 2026-09-30 | EB-28 / D-02 | Exclude Onyx `utils/encryption.py` & Activepieces plaintext/CBC patterns | Plaintext / unauthenticated AES-CBC violates tenant credential security (Risk R-12). | Enforced |
| 2026-09-30 | EB-28 / D-03 | Store CredentialStore in `packages/storage` instead of `services/control-plane` | Prevents cross-service imports from `services/ingestion` into `services/control-plane`, upholding layer hierarchy. | Approved |
| 2026-09-30 | EB-28 / D-04 | Standardize raw data store under tenant-scoped `ObjectStore` | Guarantees placement-driven prefixing and prevents unauthorized cross-tenant object access. | Approved |
| 2026-09-30 | EB-85 / D-05 | Keep `control_plane/` inside `services/control-plane/` | Matches service architectural boundaries; `packages/tenant-context` defines the dependency-inverted `TenantDirectory` protocol. | Approved |
| 2026-09-30 | EB-85 / D-06 | Cell model (`db/control/schema.sql`) adopts `pool-in-1` in `ap-south-2` | India region compliance; cell contains Postgres, object storage, Qdrant, OpenSearch, OpenFGA, Temporal namespace. | Approved |
| 2026-09-30 | EB-85 / D-07 | Seed Studio 8 (`studio8`) and synthetic canary tenant (`synthetic-canary`) | Canary tenant provides real multi-tenant leakage isolation validation in all test suites. | Approved |
| 2026-09-30 | EB-85 / D-08 | Enforce strict alphanumeric tenant IDs (`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`) | Prevents leading/trailing hyphen issues across S3 prefixes, KMS aliases, OpenSearch indices, and SQL identifiers. | Approved |
| 2026-09-30 | EB-85 / D-09 | Approve `boto3 1.35.30` and `botocore` (Apache-2.0) under Rule 7 | Required for AWS S3 object store backend and AWS KMS KeyProvider in `packages/storage`. | Approved |
| 2026-09-30 | EB-85 / D-10 | Mark Risk R-12 as Mitigated | Envelope encryption (`envelope.py`), AES-256-GCM data key wrapped by tenant KMS key, context binding, and Secret leak prevention implemented. | Mitigated |
| 2026-09-30 | EB-19 / D-11 | Core database schema v1 with compound tenant foreign keys and FORCE RLS | Physically prevents cross-tenant references at the foreign key constraint level and logically enforces tenant isolation via `app.tenant_id`. | Approved |
| 2026-09-30 | EB-19 / D-12 | Temporal knowledge graph edges (`valid_from`, `valid_to`) | Enables point-in-time historical traversal and supersession tracking without destructive updates. | Approved |
| 2026-09-30 | EB-19 / D-13 | Mandatory provenance columns (`source_id`, `source_ref`, `ingested_at`, `content_hash`) | Guarantees end-to-end evidence citation and cryptographic verifiability for every fact and entity. | Approved |
| 2026-09-30 | EB-19 / D-14 | Approve `sqlalchemy 2.0.34` (MIT) under Rule 7 | Required for declarative ORM models and ontology schema representation in `packages/ontology`. | Approved |
| 2026-09-30 | EB-20 / D-15 | Row-Level Security (`FORCE ROW LEVEL SECURITY`), `NOBYPASSRLS` app role, and store guard filter injection | Eliminates Risk R-6 by enforcing non-bypassable database RLS with `SET LOCAL app.tenant_id = :tenant_id`, dedicated `klarity_app` unprivileged role, pure ASGI TenantMiddleware, and automated Qdrant/OpenSearch tenant filter injection in `packages/storage`. | Approved |
| 2026-09-30 | EB-21 / D-16 | Single Keycloak realm `klarity` with Keycloak Organizations (ADR-013) & Admin MFA enforcement | Avoids operational overhead of realm-per-tenant while enforcing strong multi-tenancy, Google IdP integration, and blocking admin access without verified MFA (Risk R-13). | Approved |
| 2026-09-30 | EB-22 / D-17 | OpenFGA 1.1 hierarchical authorization model & 15-second check cache TTL | Implements tenant -> project -> resource relationships; restricts financial records to `finance_viewer` / `admin`; 15-second TTL optimizes retrieval performance while keeping permission revocations near real-time. | Approved |

