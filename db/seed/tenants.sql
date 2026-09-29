-- Owner task: EB-85 Tenant registry and control plane
-- Day-one tenants in the control-plane database (db/control/schema.sql): Studio 8 Hats (pool) and a
-- synthetic canary tenant, both in the pool cell. Mirrors services/control-plane/control_plane/seed.py;
-- a test keeps the ids in step. Idempotent. Tenants start in 'provisioning'; ProvisionTenant activates them.
-- tenant_resources rows are written by the registry service (placement policy), not by hand.
-- Status: DRAFT — not yet run (no Postgres in the dev environment).

BEGIN;

INSERT INTO plans (plan_id, display_name) VALUES
    ('pilot', 'Pilot')  -- placeholder until EB-87 defines plans
ON CONFLICT (plan_id) DO NOTHING;

INSERT INTO cells (cell_id, region, kind, pg_cluster, object_bucket, qdrant_cluster, opensearch_cluster,
                   fga_store, temporal_namespace) VALUES
    ('pool-in-1', 'ap-south-2', 'shared', 'pg-pool-in-1', 'klarity-pool-in-1', 'qdrant-pool-in-1',
     'os-pool-in-1', 'fga-pool-in-1', 'pool-in-1')
ON CONFLICT (cell_id) DO NOTHING;

INSERT INTO tenants (tenant_id, slug, display_name, tier, plan_id, cell_id, region, is_synthetic) VALUES
    ('0fdc5142-8c25-41c5-aab4-0a88db52a5bf', 'studio8', 'Studio 8 Hats', 'pool', 'pilot', 'pool-in-1',
     'ap-south-2', false),
    ('1bae9ff8-abf9-44bf-9b17-a5cb2c83d71b', 'synthetic-canary', 'Synthetic canary tenant', 'pool', 'pilot',
     'pool-in-1', 'ap-south-2', true)
ON CONFLICT (tenant_id) DO NOTHING;

COMMIT;
