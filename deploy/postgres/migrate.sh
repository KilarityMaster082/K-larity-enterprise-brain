#!/usr/bin/env bash
# Owner task: EB-18 Docker Compose dev stack
# Applies the schema in order as the schema owner, then the policies and views. Migrations are NOT all re-runnable
# (0001 creates policies without a guard), so each file is applied once, in its own transaction together with its
# schema_migrations row; a re-run skips what is recorded. Policies, roles and views are idempotent and re-applied.
set -euo pipefail

DB_DIR="${DB_DIR:-/db}"
admin() { PGPASSWORD="$KLARITY_ADMIN_PASSWORD" psql -v ON_ERROR_STOP=1 -q -U klarity_admin -d brain "$@"; }

echo "migrate: tenant database (brain)"
admin -c "CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
while IFS= read -r -d '' f; do
  name="$(basename "$f")"
  if [ "$(admin -tA -c "SELECT 1 FROM schema_migrations WHERE filename = '$name'")" = "1" ]; then
    echo "  -- $name (already applied)"
    continue
  fi
  echo "  -> $name"
  admin --single-transaction -f "$f" -c "INSERT INTO schema_migrations (filename) VALUES ('$name')"
done < <(find "$DB_DIR/migrations" -maxdepth 1 -name '*.sql' ! -name '*.down.sql' -print0 | sort -z)
echo "  -> policies"
admin -f "$DB_DIR"/policies/tenant.sql
# roles.sql pins klarity_app to NOBYPASSRLS / NOSUPERUSER; changing those attributes needs a superuser.
PGPASSWORD="$POSTGRES_SUPERUSER_PASSWORD" psql -v ON_ERROR_STOP=1 -q -U postgres -d brain -f "$DB_DIR"/policies/roles.sql
# the migration ledger is for the schema owner only
PGPASSWORD="$POSTGRES_SUPERUSER_PASSWORD" psql -v ON_ERROR_STOP=1 -q -U postgres -d brain -c "REVOKE ALL ON schema_migrations FROM klarity_app"
echo "  -> views"
admin -f "$DB_DIR"/views/finance.sql

echo "migrate: control-plane database"
control() { PGPASSWORD="$KLARITY_CONTROL_PASSWORD" psql -v ON_ERROR_STOP=1 -q -U klarity_control -d control_plane "$@"; }
control -c "CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
if [ "$(control -tA -c "SELECT 1 FROM schema_migrations WHERE filename = 'control/schema.sql'")" = "1" ]; then
  echo "  -- control/schema.sql (already applied)"
else
  echo "  -> control/schema.sql"
  control -f "$DB_DIR"/control/schema.sql -c "INSERT INTO schema_migrations (filename) VALUES ('control/schema.sql')"
fi

echo "migrate: done"
