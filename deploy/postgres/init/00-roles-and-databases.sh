#!/usr/bin/env bash
# Owner task: EB-18 Docker Compose dev stack
# Runs once, on an empty data volume. Creates the login roles and databases; schema comes from the migrate job.
# Roles: klarity_admin (owns schema, runs migrations), klarity_app (NOBYPASSRLS — what the API uses, ADR-011),
#        klarity_control (control-plane database only), klarity_infra (Keycloak / OpenFGA / Temporal databases).
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v admin_pw="$KLARITY_ADMIN_PASSWORD" -v app_pw="$KLARITY_APP_PASSWORD" \
  -v control_pw="$KLARITY_CONTROL_PASSWORD" -v infra_pw="$INFRA_DB_PASSWORD" <<'SQL'
CREATE ROLE klarity_admin   LOGIN NOSUPERUSER CREATEDB PASSWORD :'admin_pw';
CREATE ROLE klarity_app     LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'app_pw';
CREATE ROLE klarity_control LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'control_pw';
CREATE ROLE klarity_infra   LOGIN NOSUPERUSER CREATEDB PASSWORD :'infra_pw';

CREATE DATABASE brain         OWNER klarity_admin;
CREATE DATABASE control_plane OWNER klarity_control;
CREATE DATABASE keycloak      OWNER klarity_infra;
CREATE DATABASE openfga       OWNER klarity_infra;

REVOKE ALL ON DATABASE brain FROM PUBLIC;
REVOKE ALL ON DATABASE control_plane FROM PUBLIC;
GRANT CONNECT ON DATABASE brain TO klarity_app;           -- the app role never connects to control_plane (ADR-011)
SQL
