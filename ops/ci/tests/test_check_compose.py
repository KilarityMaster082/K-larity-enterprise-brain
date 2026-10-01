# Owner task: EB-18 Docker Compose dev stack
from __future__ import annotations

import copy
import os
import stat
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(ROOT / "ops" / "ci"), str(ROOT / "ops" / "dev")]
import check_compose as cc  # noqa: E402
import gen_env  # noqa: E402


@pytest.fixture
def compose() -> dict:
    return yaml.safe_load(cc.COMPOSE.read_text(encoding="utf-8"))


def test_the_real_compose_file_is_clean(compose) -> None:
    assert cc.check(compose, set(gen_env.SECRETS)) == []


def test_all_expected_services_exist(compose) -> None:
    assert {"postgres", "migrate", "keycloak", "openfga", "qdrant", "opensearch", "valkey", "temporal", "seaweedfs"} <= set(compose["services"])


@pytest.mark.parametrize("mutate,needle", [
    (lambda c: c["services"]["qdrant"].update(image="qdrant/qdrant:latest"), "pinned"),
    (lambda c: c["services"]["qdrant"].update(image="qdrant/qdrant"), "pinned"),
    (lambda c: c["services"]["postgres"].update(ports=["5432:5432"]), "127.0.0.1"),
    (lambda c: c["services"]["valkey"]["environment"].update(REDISCLI_AUTH="hunter2"), "literal"),
    (lambda c: c["services"]["valkey"].update(command=["valkey-server", "--requirepass", "hunter2"]), "command argument"),
    (lambda c: c["services"]["opensearch"].pop("healthcheck"), "healthcheck"),
    (lambda c: c["services"]["migrate"].update(depends_on={"ghost": {"condition": "service_healthy"}}), "unknown service"),
    (lambda c: c["services"]["qdrant"].update(volumes=["nope:/x"]), "not declared"),
])
def test_checker_catches_each_class_of_mistake(compose, mutate, needle) -> None:
    broken = copy.deepcopy(compose)
    mutate(broken)
    assert any(needle in p for p in cc.check(broken, set(gen_env.SECRETS)))


def test_missing_generated_secret_is_reported(compose) -> None:
    assert any("QDRANT_API_KEY" in p for p in cc.check(compose, set(gen_env.SECRETS) - {"QDRANT_API_KEY"}))


def test_env_generator_writes_private_unique_secrets_and_never_overwrites(tmp_path) -> None:
    path = tmp_path / ".env.dev"
    assert gen_env.main(["--path", str(path)]) == 0
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    values = dict(line.split("=", 1) for line in path.read_text().splitlines() if "=" in line and not line.startswith("#"))
    assert set(values) == set(gen_env.SECRETS) and len(set(values.values())) == len(values) and all(len(v) >= 24 for v in values.values())
    before = path.read_text()
    gen_env.main(["--path", str(path)])
    assert path.read_text() == before  # a running stack's passwords are not changed
    gen_env.main(["--path", str(path), "--force"])
    assert path.read_text() != before


def test_postgres_init_pins_the_app_role_and_isolates_databases() -> None:
    sql = (ROOT / "deploy" / "postgres" / "init" / "00-roles-and-databases.sh").read_text()
    assert "klarity_app     LOGIN NOSUPERUSER NOBYPASSRLS" in sql
    assert "REVOKE ALL ON DATABASE control_plane FROM PUBLIC" in sql and "GRANT CONNECT ON DATABASE control_plane" not in sql
    assert "PASSWORD :'" in sql and "PASSWORD '" not in sql  # never a literal password


def test_migrate_script_orders_files_and_skips_down_migrations() -> None:
    script = (ROOT / "deploy" / "postgres" / "migrate.sh").read_text()
    assert "grep -v '\\.down\\.sql$'" in script and "sort" in script
    assert "-U postgres -d brain -f /db/policies/roles.sql" in script  # superuser: pins NOBYPASSRLS
    assert script.index("migrations") < script.index("policies/tenant.sql") < script.index("views/finance.sql")
