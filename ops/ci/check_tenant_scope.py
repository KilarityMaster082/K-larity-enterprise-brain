"""Tenant-scope gate: no store is reachable except through a TenantContext-guarded wrapper.

Owner task: EB-85 Tenant registry and control plane
Two static rules; the runtime half is tenant_context.TenantScopedStore (fails without a context).
1. Raw clients for tenant data stores (Postgres, S3, Qdrant, OpenSearch, OpenFGA, Valkey) may be imported
   only in store-wrapper code (ALLOWED_DIRS). Anywhere else they would bypass the guard.
2. In packages/storage, every class named *Store must subclass TenantScopedStore.

Usage: python ops/ci/check_tenant_scope.py
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCANNED_ROOTS = ("agents", "apps", "packages", "packs", "services")
RAW_CLIENTS = frozenset({
    "aioboto3", "asyncpg", "boto3", "botocore", "minio", "openfga_sdk", "opensearchpy", "psycopg",
    "psycopg2", "psycopg_pool", "qdrant_client", "redis", "sqlalchemy", "valkey",
})
# Store wrappers, plus the control plane (its own database holds no tenant data).
ALLOWED_DIRS = ("packages/storage/", "services/control-plane/control_plane/")
STORE_PACKAGE = "packages/storage/"
GUARD_BASE = "TenantScopedStore"


def _imported_roots(tree: ast.AST) -> list[tuple[int, str]]:
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            out += [(node.lineno, a.name.split(".")[0]) for a in node.names]
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            out.append((node.lineno, node.module.split(".")[0]))
    return out


def _base_name(b: ast.expr) -> str:
    return b.attr if isinstance(b, ast.Attribute) else getattr(b, "id", "")


def check_file(rel: str, source: str) -> list[str]:
    errors = []
    try:
        tree = ast.parse(source)
    except SyntaxError as e:
        return [f"{rel}: cannot parse ({e.msg})"]
    if not rel.startswith(ALLOWED_DIRS):
        for line, mod in _imported_roots(tree):
            if mod in RAW_CLIENTS:
                errors.append(f"{rel}:{line}: imports {mod} outside a store wrapper — use packages/storage")
    if rel.startswith(STORE_PACKAGE) and "/tests/" not in rel:
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef) and node.name.endswith("Store"):
                if GUARD_BASE not in {_base_name(b) for b in node.bases}:
                    errors.append(f"{rel}:{node.lineno}: {node.name} must subclass {GUARD_BASE}")
    return errors


def main() -> int:
    errors: list[str] = []
    n = 0
    for root in SCANNED_ROOTS:
        for f in sorted((REPO / root).rglob("*.py")):
            if "__pycache__" in f.parts:
                continue
            n += 1
            errors += check_file(f.relative_to(REPO).as_posix(), f.read_text(errors="ignore"))
    for e in errors:
        print(f"error: {e}")
    print(f"tenant-scope check: {n} files, {len(errors)} error(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
