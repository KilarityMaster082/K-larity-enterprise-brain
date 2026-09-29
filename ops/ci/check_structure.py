"""Repository governance gate: layout, ownership, licence boundaries and vendored-code integrity.

Owner task: EB-17 CI: lint, tests, licence scan and secret scan
Enforces CLAUDE.md "Architecture boundaries" and the Borrow Register rules (EB-76, Risk R-7, R-12).
Adding a new top-level or second-level folder means editing LAYOUT below in a reviewed PR.

Usage: python ops/ci/check_structure.py
"""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vendor_upstream import BANNED_FILES, BANNED_SEGMENTS, MANIFESTS  # noqa: E402

REPO = Path(__file__).resolve().parents[2]

ROOT_FILES = {
    ".cursorrules", ".dockerignore", ".env.example", ".gitignore", "AGENTS.md", "CLAUDE.md",
    "DECISIONS.md", "GEMINI.md", "LICENSE", "LICENSES.md", "Makefile", "README.md", "SECURITY.md",
    "THIRD_PARTY_NOTICES.md", "package.json", "pnpm-workspace.yaml", "pyproject.toml", "turbo.json",
}
# top-level dir -> allowed children (None = any)
LAYOUT: dict[str, set[str] | None] = {
    ".github": None,
    "agents": {"document_intelligence", "meeting", "project_manager"},
    "apps": {"admin", "api", "web"},
    "db": {"control", "migrations", "policies", "seed", "views"},
    "deploy": None,
    "docs": None,
    "ops": None,
    "packages": {"ai-core", "approvals", "connectors-sdk", "observability", "ontology", "permissions",
                 "schemas", "storage", "tenant-context"},
    "packs": {"aec"},
    "services": {"context-engine", "control-plane", "entity-resolution", "evaluation", "ingestion",
                 "knowledge-graph", "llm-gateway", "memory", "metering", "normalization", "signals"},
    "third_party": None,  # checked against the vendoring manifest below
}
OWNED_ROOTS = ("agents", "apps", "db", "deploy", "ops", "packages", "packs", "services")
HEADER_EXEMPT_SUFFIXES = {".json", ".gitkeep", ".png", ".svg", ".ico", ".lock"}
CORE_ROOTS = ("apps", "services", "packages", "agents")
PACK_IMPORT = re.compile(r"^\s*(from|import)\s+packs[.\s]|['\"]packs/aec", re.M)
IGNORED_NAMES = {".DS_Store", "__pycache__", "node_modules", ".venv", ".pytest_cache"}


def tracked_files() -> list[Path]:
    try:
        out = subprocess.check_output(["git", "-C", str(REPO), "ls-files", "--cached", "--others",
                                       "--exclude-standard"], text=True)
        return [REPO / p for p in out.splitlines() if p]
    except (subprocess.CalledProcessError, FileNotFoundError):
        return [p for p in REPO.rglob("*") if p.is_file() and ".git" not in p.parts]


def check_layout(files: list[Path], errors: list[str]) -> None:
    for f in files:
        parts = f.relative_to(REPO).parts
        if IGNORED_NAMES & set(parts):
            errors.append(f"{'/'.join(parts)}: OS/build artefact must be gitignored")
            continue
        if len(parts) == 1:
            if parts[0] not in ROOT_FILES:
                errors.append(f"{parts[0]}: file not allowed at repo root")
            continue
        top = parts[0]
        if top not in LAYOUT:
            errors.append(f"{top}/: top-level folder not in CLAUDE.md architecture")
            continue
        allowed = LAYOUT[top]
        if allowed is not None and len(parts) > 2 and parts[1] not in allowed:
            errors.append(f"{top}/{parts[1]}/: not a registered {top} folder (edit LAYOUT via reviewed PR)")


def check_licence_boundaries(files: list[Path], errors: list[str]) -> None:
    for f in files:
        rel = f.relative_to(REPO)
        if BANNED_SEGMENTS & {p.lower() for p in rel.parts[:-1]}:
            errors.append(f"{rel}: ee/enterprise path is forbidden (Risk R-7)")
        if any(str(rel).endswith(b) for b in BANNED_FILES):
            errors.append(f"{rel}: banned upstream file (Risk R-12)")


def check_ownership(files: list[Path], errors: list[str], warnings: list[str]) -> None:
    for f in files:
        rel = f.relative_to(REPO)
        if rel.parts[0] not in OWNED_ROOTS or f.suffix in HEADER_EXEMPT_SUFFIXES or f.name.startswith("."):
            continue
        if f.stat().st_size == 0:
            continue
        head = f.read_text(errors="ignore")[:800]
        if "Owner task: EB-" not in head:
            if "Owner task: UNOWNED" in head:
                warnings.append(f"{rel}: owner task not assigned")
            else:
                errors.append(f"{rel}: missing 'Owner task: EB-<id>' header")


def check_pack_isolation(files: list[Path], errors: list[str]) -> None:
    for f in files:
        rel = f.relative_to(REPO)
        if rel.parts[0] in CORE_ROOTS and f.suffix in {".py", ".ts", ".tsx"}:
            if PACK_IMPORT.search(f.read_text(errors="ignore")):
                errors.append(f"{rel}: core imports packs/ — AEC must be optional (CLAUDE.md rule 6)")


def approved_copy_tools() -> set[str]:
    reg = json.loads((REPO / "docs/borrow/borrow-register.json").read_text())
    return {t["repo"].rstrip("/").rsplit("/", 1)[-1].lower() for t in reg["tools"]
            if t["decision"] == "Adopt" and t["verdict"] == "Copy with attribution"}


def check_third_party(files: list[Path], errors: list[str]) -> None:
    approved = approved_copy_tools()
    tp = REPO / "third_party"
    present = {p.name for p in tp.iterdir() if p.is_dir()} if tp.exists() else set()
    for tool in sorted(present):
        if tool not in approved or tool not in MANIFESTS:
            errors.append(f"third_party/{tool}: not an approved Adopt + Copy-with-attribution tool")
            continue
        root = tp / tool
        for need in ("LICENSE", "UPSTREAM.yaml"):
            if not (root / need).is_file():
                errors.append(f"third_party/{tool}/{need}: missing")
        manifest = (root / "UPSTREAM.yaml").read_text() if (root / "UPSTREAM.yaml").exists() else ""
        if f"commit: {MANIFESTS[tool]['commit']}" not in manifest:
            errors.append(f"third_party/{tool}: UPSTREAM.yaml commit differs from pinned commit")
        listed = dict(re.findall(r"\{path: ([^,]+), sha256: ([0-9a-f]+)\}", manifest))
        for rel, digest in listed.items():
            src = root / "src" / rel
            if not src.is_file():
                errors.append(f"third_party/{tool}/src/{rel}: listed in UPSTREAM.yaml but missing")
            elif hashlib.sha256(src.read_bytes()).hexdigest()[: len(digest)] != digest:
                errors.append(f"third_party/{tool}/src/{rel}: edited in place — adapt into the target path instead")
        for f in files:
            r = f.relative_to(root) if root in f.parents else None
            if r and r.parts[0] == "src" and str(Path(*r.parts[1:])) not in listed:
                errors.append(f"third_party/{tool}/{r}: not in UPSTREAM.yaml (vendor via ops/ci/vendor_upstream.py)")


def main() -> int:
    files = [f for f in tracked_files() if f.is_file()]
    errors: list[str] = []
    warnings: list[str] = []
    check_layout(files, errors)
    check_licence_boundaries(files, errors)
    check_ownership(files, errors, warnings)
    check_pack_isolation(files, errors)
    check_third_party(files, errors)
    for w in warnings:
        print(f"warn: {w}")
    for e in errors:
        print(f"error: {e}")
    print(f"structure check: {len(files)} files, {len(errors)} error(s), {len(warnings)} warning(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
