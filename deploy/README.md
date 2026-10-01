# Local development stack (EB-18)

PostgreSQL 16 (row-level security), Keycloak (realm imported from `deploy/keycloak/realm.json`), OpenFGA, Qdrant,
OpenSearch, Valkey, Temporal and SeaweedFS (S3). Development only — everything is bound to `127.0.0.1`.

```bash
make dev-up      # generates deploy/.env.dev (random secrets, gitignored) and starts the stack, waiting for health
make dev-down    # stop, keep data
make dev-reset   # stop and delete all data
```

Needs Docker with Compose v2 and about 4 GB of memory. The `migrate` job applies `db/migrations`, `db/policies`,
`db/views` and `db/control`; re-running is a no-op. Roles: `klarity_app` is `NOBYPASSRLS` and cannot connect to the
control-plane database.

`make governance` runs `ops/ci/check_compose.py` (no Docker needed): images pinned, ports on 127.0.0.1, no literal secrets,
healthchecks on stateful services.

Known dev-only shortcuts: OpenSearch runs with the security plugin off, SeaweedFS S3 has no credentials, and the Keycloak
realm falls back to a development client secret if `KEYCLOAK_WEB_CLIENT_SECRET` is unset. Production (`deploy/prod`) must not.
