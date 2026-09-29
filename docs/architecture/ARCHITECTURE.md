# Architecture: tenancy, cells and placement

> Owner task: EB-85 Tenant registry and control plane
> Sources: research/foundation-fit.md §4.1–4.4 · ADR-011 (tiered tenancy with cells and a registry) ·
> ADR-014 (tenant lifecycle as workflows with a control-plane registry)

K!larity is one codebase serving many companies. Studio 8 Hats is tenant #1, not the design target.
This page explains how tenants are isolated, where each tenant's data lives, and how code finds out.

## 1. Tiers

Each tenant is on one of three tiers. The tier decides how much of the stack the tenant shares.

| Tier | Who | Isolation |
|---|---|---|
| **Pool** | Most tenants, including Studio 8 | Shared stack. Isolation is logical: Postgres RLS, a tenant filter on every index query, a filtered OpenSearch alias, and an object prefix per tenant. |
| **Bridge** | Large or noisy tenants | Shared application in the shared cell, plus a dedicated Postgres database, Qdrant shard key, OpenSearch index and Temporal queues. |
| **Silo** | Regulated or very large tenants | A dedicated cell (or the customer's own cloud). |

## 2. Cells

A **cell** is one full copy of the stack: Postgres, object storage, Qdrant, OpenSearch, OpenFGA and a
Temporal namespace, in one region. The pool is a large shared cell. A silo is a cell that holds exactly
one tenant. Growth means adding cells, not making one cell bigger forever.

Day one has one cell, `pool-in-1` in `ap-south-2` (Hyderabad). It holds two tenants: Studio 8 and a
synthetic canary tenant. The canary exists so every cross-tenant test has a real second tenant to
leak into.

## 3. The registry

The control plane has its own database (`db/control/schema.sql`), separate from tenant data and not
reachable by the application role. It records:

- `cells`: each cell, its region and the names of its resources.
- `tenants`: id, slug, status, tier, plan, cell and region.
- `tenant_resources`: the tenant's **placement**, one row per resource (bucket and prefix, Qdrant shard
  key, OpenSearch index and alias, Postgres database, Temporal queue prefix, LiteLLM team, KMS key
  alias, Keycloak organization).
- `plans`, `entitlements`, `tenant_overrides` and `usage_ledger`, which EB-87 builds on.

The placement is computed once, at registration, by
`services/control-plane/control_plane/placement.py`. **That is the only code that looks at the tier.**
Everything else reads the stored placement. This means moving a tenant from pool to bridge is a data
migration plus a registry update, with no code change.

Tenant status follows a fixed lifecycle. Only `active` tenants are served:

```
provisioning → active ⇄ suspended
      │           │         │
      └──────→ offboarding ←┘ → offboarded (terminal)
```

## 4. Tenant context in every call

```
Keycloak token (organization) ─┐
Temporal activity input ───────┼─→ PlacementResolver.scope(tenant_id) ─→ TenantContext (contextvar)
CLI / admin job ───────────────┘            │                                  │
                                    registry lookup                    store wrappers read
                                    (30 s cache)                       ctx.placement
```

- `packages/tenant-context` holds `TenantContext` (tenant id, status, tier and placement) in a context
  variable. Reading it when it is unset raises an error. There is no default tenant.
- Entering a scope for tenant B while tenant A's scope is active is refused.
- New threads do not inherit the scope. Background work passes `tenant_id` in its input and resolves it
  again.
- `PlacementResolver` only resolves `active` tenants. A suspension takes effect within the cache TTL,
  or immediately when `invalidate()` is called.

## 5. Stores only through wrappers

Every store wrapper subclasses `TenantScopedStore`. Each public method then:

- fails without a tenant context;
- fails if it is given a `tenant_id` that differs from the active tenant;
- takes bucket, prefix, shard key and similar values from the placement, never from its arguments.

`packages/storage/storage/object_store.py` is the first such wrapper.

`ops/ci/check_tenant_scope.py` runs in CI and enforces two rules:

- raw clients for tenant data stores (Postgres, S3, Qdrant, OpenSearch, OpenFGA and Valkey) can be
  imported only in `packages/storage/` and the control plane;
- every `*Store` class in `packages/storage` must use the guard.

Postgres rows are also protected by RLS with `FORCE`, using `SET LOCAL app.tenant_id` inside each
transaction (EB-20).

## 6. Not built yet

- The Postgres registry: the control database is not deployed yet, so dev and tests use the JSON-file
  registry.
- The `ProvisionTenant` and `OffboardTenant` workflows.
- The S3 object backend.
- The per-tenant envelope-encrypted credential store (Risk R-12), which waits on the crypto dependency
  decision.
