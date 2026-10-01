#!/usr/bin/env bash
# Owner task: EB-18 Docker Compose dev stack
# Applies the schema in order, as the schema owner, then the policies and views. Safe to re-run: every
# migration uses IF NOT EXISTS, so a second `docker compose up` changes nothing.
set -euo pipefail

admin() { PGPASSWORD="$KLARITY_ADMIN_PASSWORD" psql -v ON_ERROR_STOP=1 -q -U klarity_admin -d brain "$@"; }

echo "migrate: tenant database (brain)"
for f in $(ls /db/migrations/*.sql | grep -v '\.down\.sql$' | sort); do
  echo "  -> $f"
  admin -f "$f"
done
echo "  -> policies"
admin -f /db/policies/tenant.sql
# roles.sql pins klarity_app to NOBYPASSRLS / NOSUPERUSER; changing those attributes needs a superuser.
PGPASSWORD="$POSTGRES_SUPERUSER_PASSWORD" psql -v ON_ERROR_STOP=1 -q -U postgres -d brain -f /db/policies/roles.sql
echo "  -> views"
admin -f /db/views/finance.sql

echo "migrate: control-plane database"
PGPASSWORD="$KLARITY_CONTROL_PASSWORD" psql -v ON_ERROR_STOP=1 -q -U klarity_control -d control_plane -f /db/control/schema.sql

echo "migrate: done"
