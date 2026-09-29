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

