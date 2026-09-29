# Owner task: EB-19 Database schema v1
"""Tests for migration scripts 0001_initial.sql and 0001_initial.down.sql.

Validates multi-tenant isolation, RLS rules, temporal columns, provenance columns,
index coverage, and verifies up/down migration execution cleanly.
"""

from __future__ import annotations

from pathlib import Path
import re
import sqlite3
import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS_DIR = REPO_ROOT / "db" / "migrations"
UP_SQL_PATH = MIGRATIONS_DIR / "0001_initial.sql"
DOWN_SQL_PATH = MIGRATIONS_DIR / "0001_initial.down.sql"

CORE_TABLES = [
    "users",
    "projects",
    "source_records",
    "documents",
    "chunks",
    "entities",
    "aliases",
    "edges",
    "events",
    "decisions",
    "finance_txns",
]


def test_migration_files_exist_and_owned() -> None:
    """Verifies that migration files exist and carry the EB-19 owner header."""
    assert UP_SQL_PATH.is_file(), f"Missing {UP_SQL_PATH}"
    assert DOWN_SQL_PATH.is_file(), f"Missing {DOWN_SQL_PATH}"

    up_content = UP_SQL_PATH.read_text()
    down_content = DOWN_SQL_PATH.read_text()

    assert "Owner task: EB-19 Database schema v1" in up_content[:200]
    assert "Owner task: EB-19 Database schema v1" in down_content[:200]


def test_up_migration_static_requirements() -> None:
    """Static schema validation for all mandatory multi-tenant and provenance rules."""
    sql = UP_SQL_PATH.read_text()

    for table in CORE_TABLES:
        # 1. Every table must be created
        create_pattern = rf"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+{table}\s*\((.*?)\);"
        match = re.search(create_pattern, sql, re.DOTALL | re.IGNORECASE)
        assert match is not None, f"Table {table} not created in {UP_SQL_PATH.name}"

        body = match.group(1)

        # 2. Every table must have tenant_id NOT NULL
        assert re.search(r"tenant_id\s+text\s+NOT\s+NULL", body, re.IGNORECASE), (
            f"Table {table} missing 'tenant_id text NOT NULL'"
        )

        # 3. Every table must have tenant_id regex check
        assert "tenant_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'" in body, (
            f"Table {table} missing tenant_id alphanumeric regex check"
        )

        # 4. Explicit index on tenant_id
        idx_pattern = rf"CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_{table}_tenant_id\s+ON\s+{table}\s*\(tenant_id\);"
        assert re.search(idx_pattern, sql, re.IGNORECASE), (
            f"Missing index on tenant_id for table {table}"
        )

        # 5. RLS and FORCE RLS enabled
        assert re.search(rf"ALTER\s+TABLE\s+{table}\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY;", sql, re.IGNORECASE), (
            f"Table {table} missing ENABLE ROW LEVEL SECURITY"
        )
        assert re.search(rf"ALTER\s+TABLE\s+{table}\s+FORCE\s+ROW\s+LEVEL\s+SECURITY;", sql, re.IGNORECASE), (
            f"Table {table} missing FORCE ROW LEVEL SECURITY"
        )

        # 6. Tenant isolation policy
        policy_pattern = (
            rf"CREATE\s+POLICY\s+{table}_tenant_isolation\s+ON\s+{table}\s+"
            rf"USING\s*\(tenant_id\s*=\s*current_setting\('app\.tenant_id',\s*true\)\)\s+"
            rf"WITH\s+CHECK\s*\(tenant_id\s*=\s*current_setting\('app\.tenant_id',\s*true\)\);"
        )
        assert re.search(policy_pattern, sql, re.IGNORECASE), (
            f"Table {table} missing tenant isolation policy"
        )

    # Subtask 2: Temporal columns on edges
    edges_match = re.search(r"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+edges\s*\((.*?)\);", sql, re.DOTALL | re.IGNORECASE)
    assert edges_match is not None
    edges_body = edges_match.group(1)
    assert "valid_from" in edges_body
    assert "valid_to" in edges_body
    assert "CHECK (valid_to IS NULL OR valid_to >= valid_from)" in edges_body

    # Subtask 3: Provenance columns on records and entities
    for prov_table in ["source_records", "documents", "chunks", "entities", "edges", "events", "decisions", "finance_txns"]:
        tbl_match = re.search(rf"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+{prov_table}\s*\((.*?)\);", sql, re.DOTALL | re.IGNORECASE)
        assert tbl_match is not None
        tbl_body = tbl_match.group(1)
        assert "source_id" in tbl_body, f"Table {prov_table} missing source_id"
        assert "source_ref" in tbl_body, f"Table {prov_table} missing source_ref"
        assert "ingested_at" in tbl_body, f"Table {prov_table} missing ingested_at"
        assert "content_hash" in tbl_body, f"Table {prov_table} missing content_hash"


def test_down_migration_drops_all_tables() -> None:
    """Verifies that 0001_initial.down.sql cleanly drops all policies and tables."""
    down_sql = DOWN_SQL_PATH.read_text()

    for table in CORE_TABLES:
        # Checks policy drop
        assert f"DROP POLICY IF EXISTS {table}_tenant_isolation ON {table};" in down_sql
        # Checks table drop
        assert f"DROP TABLE IF EXISTS {table};" in down_sql

    # Check reverse drop order (child tables before parent tables)
    pos_finance = down_sql.find("DROP TABLE IF EXISTS finance_txns;")
    pos_decisions = down_sql.find("DROP TABLE IF EXISTS decisions;")
    pos_events = down_sql.find("DROP TABLE IF EXISTS events;")
    pos_edges = down_sql.find("DROP TABLE IF EXISTS edges;")
    pos_aliases = down_sql.find("DROP TABLE IF EXISTS aliases;")
    pos_chunks = down_sql.find("DROP TABLE IF EXISTS chunks;")
    pos_entities = down_sql.find("DROP TABLE IF EXISTS entities;")
    pos_docs = down_sql.find("DROP TABLE IF EXISTS documents;")
    pos_projects = down_sql.find("DROP TABLE IF EXISTS projects;")
    pos_users = down_sql.find("DROP TABLE IF EXISTS users;")

    assert pos_chunks < pos_docs < pos_projects
    assert pos_aliases < pos_entities
    assert pos_edges < pos_entities
    assert pos_finance < pos_projects
    assert pos_decisions < pos_projects
    assert pos_events < pos_projects
    assert pos_users > pos_projects


def _sqlite_compat(statement: str) -> str | None:
    """Convert Postgres-specific DDL statement to SQLite equivalent or skip."""
    lines = [line for line in statement.splitlines() if not line.strip().startswith("--")]
    s = "\n".join(lines).strip()
    if not s:
        return None
    # Skip Postgres-only RLS and POLICY statements for SQLite simulation
    if re.match(r"^ALTER\s+TABLE\s+.*\s+(ENABLE|FORCE)\s+ROW\s+LEVEL\s+SECURITY", s, re.IGNORECASE):
        return None
    if re.match(r"^CREATE\s+POLICY\s+", s, re.IGNORECASE):
        return None
    if re.match(r"^DROP\s+POLICY\s+", s, re.IGNORECASE):
        return None

    # Replace Postgres regex checks with empty string
    s = re.sub(r"\s+CHECK\s*\([^;]*?~[^;]*?\)", "", s)
    s = re.sub(r"\bnow\(\)", "CURRENT_TIMESTAMP", s, flags=re.IGNORECASE)
    s = re.sub(r"::[a-zA-Z_]+", "", s)
    return s


def test_up_and_down_migration_execution() -> None:
    """Subtask 5: Execute Up migration against SQLite, perform operations, and execute Down migration."""
    conn = sqlite3.connect(":memory:")
    cursor = conn.cursor()
    cursor.execute("PRAGMA foreign_keys = ON;")

    # 1. Run UP migration
    up_sql = UP_SQL_PATH.read_text()
    raw_statements = up_sql.split(";")
    for stmt in raw_statements:
        clean = _sqlite_compat(stmt)
        if clean:
            cursor.execute(clean)
    conn.commit()

    # Verify all 11 tables exist in sqlite_master
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
    tables_created = {row[0] for row in cursor.fetchall()}
    assert set(CORE_TABLES) == tables_created

    # 2. Insert test data to confirm constraints work
    cursor.execute(
        """
        INSERT INTO users (tenant_id, user_id, email, full_name, role, status)
        VALUES ('t1', 'u1', 'u1@example.com', 'User One', 'admin', 'active');
        """
    )
    cursor.execute(
        """
        INSERT INTO projects (tenant_id, project_id, name, status, currency)
        VALUES ('t1', 'p1', 'Project One', 'active', 'INR');
        """
    )
    cursor.execute(
        """
        INSERT INTO documents (tenant_id, document_id, project_id, title, storage_ref, content_hash)
        VALUES ('t1', 'd1', 'p1', 'Doc One', 's3://bucket/d1', 'sha256:' || hex(randomblob(32)));
        """
    )
    cursor.execute(
        """
        INSERT INTO chunks (tenant_id, chunk_id, document_id, chunk_index, text_content, content_hash)
        VALUES ('t1', 'c1', 'd1', 0, 'Chunk one content', 'sha256:' || hex(randomblob(32)));
        """
    )
    conn.commit()

    cursor.execute("SELECT count(*) FROM chunks WHERE tenant_id = 't1';")
    assert cursor.fetchone()[0] == 1

    # 3. Run DOWN migration
    down_sql = DOWN_SQL_PATH.read_text()
    down_statements = down_sql.split(";")
    for stmt in down_statements:
        clean = _sqlite_compat(stmt)
        if clean:
            cursor.execute(clean)
    conn.commit()

    # Verify all tables are completely removed
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
    remaining_tables = [row[0] for row in cursor.fetchall()]
    assert remaining_tables == [], f"Expected 0 tables remaining, found: {remaining_tables}"

    conn.close()
