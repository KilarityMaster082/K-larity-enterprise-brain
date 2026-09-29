"""Vendor approved upstream code into third_party/<tool>/ at a pinned commit.

Owner task: EB-76 Licence verdicts and Borrow Register sign-off
Only tools whose Borrow Register verdict is "Copy with attribution" AND decision is "Adopt"
may be listed here. Paths with an `ee` / `enterprise` segment and banned files are refused.

Usage: python ops/ci/vendor_upstream.py <upstream_root> [tool ...]
  <upstream_root> holds full clones (e.g. ../.upstream/onyx) checked out at the pinned commit.
"""

from __future__ import annotations

import hashlib
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
THIRD_PARTY = REPO / "third_party"

BANNED_SEGMENTS = {"ee", "enterprise"}
BANNED_FILES = {
    # MIT but stores connector credentials as plaintext (Risk R-12, Borrow Register caveat)
    "backend/onyx/utils/encryption.py",
}
SKIP_DIRS = {"node_modules", "__pycache__", "dist", ".turbo"}

# feature id -> (upstream paths, target repo path, EB task)
MANIFESTS: dict[str, dict] = {
    "onyx": {
        "repo": "https://github.com/onyx-dot-app/onyx",
        "commit": "a18fc1a652ff2b67ef7b1aae59dbfed013739365",
        "licence": "MIT (Expat); ee/ directories excluded",
        "register": "https://app.notion.com/3eae3304343e8179b7d2dae74281a0c6",
        "features": {
            "O1": (["backend/onyx/connectors/interfaces.py", "backend/onyx/connectors/models.py",
                    "backend/onyx/connectors/exceptions.py", "backend/onyx/connectors/connector_runner.py",
                    "backend/onyx/connectors/credentials_provider.py"],
                   "packages/connectors-sdk/", 28),
            "O2": (["backend/onyx/background/indexing/checkpointing_utils.py"], "packages/connectors-sdk/", 28),
            "O3": (["backend/onyx/connectors/cross_connector_utils"], "packages/connectors-sdk/", 28),
            "O4-gmail": (["backend/onyx/connectors/gmail", "backend/onyx/connectors/google_utils"],
                         "services/ingestion/connectors/gmail/", 31),
            "O4-drive": (["backend/onyx/connectors/google_drive"],
                         "services/ingestion/connectors/drive/ + sheets/", 33),
            "O4-file": (["backend/onyx/connectors/file"], "services/ingestion/connectors/file_drop/", 35),
            "O4-imap": (["backend/onyx/connectors/imap"], "services/ingestion/connectors/ (next)", 31),
            "O4-web": (["backend/onyx/connectors/web"], "services/ingestion/connectors/ (next)", 28),
            "O4-microsoft": (["backend/onyx/connectors/microsoft_utils", "backend/onyx/connectors/sharepoint",
                              "backend/onyx/connectors/onedrive", "backend/onyx/connectors/outlook",
                              "backend/onyx/connectors/teams"],
                             "services/ingestion/connectors/ (next 30 days)", 28),
            "O5": (["backend/onyx/access/utils.py", "backend/onyx/access/models.py",
                    "backend/onyx/access/access.py", "backend/onyx/document_index/opensearch/search.py"],
                   "packages/permissions/filter.py", 42),
            "O6": (["backend/shared_configs/contextvars.py"], "packages/tenant-context/", 85),
            "O7": (["backend/onyx/document_index/opensearch/schema.py"], "services/context-engine/indexing/", 36),
            "O8": (["backend/onyx/background/indexing/run_docfetching.py"], "services/ingestion/workflows/", 29),
            "O9": (["backend/onyx/document_index/factory.py"], "services/context-engine/indexing/", 36),
            "O10": (["backend/onyx/indexing/indexing_pipeline.py"], "services/context-engine/indexing/", 36),
        },
    },
    "activepieces": {
        "repo": "https://github.com/activepieces/activepieces",
        "commit": "611db01a865b84a0f900f4b078de275d43529423",
        "licence": "MIT (Expat); packages/ee, server/api/src/app/ee and every other ee/ folder excluded",
        "register": "https://app.notion.com/3eae3304343e814a9b73f47299508c13",
        "features": {
            "A1": (["packages/pieces/framework/src/lib"], "packages/connectors-sdk/ (actions/triggers)", 28),
            "A2-gmail": (["packages/pieces/community/gmail/src"], "services/ingestion/connectors/gmail/", 31),
            "A2-sheets": (["packages/pieces/community/google-sheets/src"], "services/ingestion/connectors/sheets/", 33),
            "A2-drive": (["packages/pieces/community/google-drive/src"], "services/ingestion/connectors/drive/", 35),
            "A2-whatsapp": (["packages/pieces/community/whatsapp/src"],
                            "services/ingestion/connectors/whatsapp_cloud/", 34),
            "A2-http": (["packages/pieces/core/http/src"], "packages/connectors-sdk/ (http action)", 28),
            "A3": (["packages/pieces/common/src/lib/polling"], "packages/connectors-sdk/", 28),
            "A4": (["packages/server/api/src/app/trigger/dedupe-service.ts"], "packages/connectors-sdk/", 28),
            "A5": (["packages/pieces/core/approval/src", "packages/server/api/src/app/waitpoints",
                    "packages/core/execution/src/lib/flow-run/waitpoint"], "packages/approvals/", 66),
            "A7": (["packages/server/api/src/app/flows/flow/flow.service.ts"], "packages/approvals/ (versions)", 66),
            "A8": (["packages/server/engine/src/lib/helper/error-handling.ts"], "services/ingestion/workflows/", 29),
            "A9": (["packages/server/api/src/app/app-connection"], "services/control-plane/ (credential store)", 85),
            "A10": (["packages/server/api/src/app/mcp"], "apps/api/ (MCP gateway, next)", 28),
        },
    },
}


def refused(rel: str) -> str | None:
    parts = Path(rel).parts
    if BANNED_SEGMENTS & set(parts):
        return "ee/enterprise path"
    if rel in BANNED_FILES:
        return "banned file"
    return None


def iter_files(src_root: Path, rel: str):
    p = src_root / rel
    if p.is_file():
        yield rel
        return
    for f in sorted(p.rglob("*")):
        if f.is_file() and not (SKIP_DIRS & set(f.relative_to(src_root).parts)):
            yield str(f.relative_to(src_root))


def vendor(tool: str, upstream_root: Path) -> None:
    m = MANIFESTS[tool]
    src = upstream_root / tool
    head = subprocess.check_output(["git", "-C", str(src), "rev-parse", "HEAD"], text=True).strip()
    if head != m["commit"]:
        sys.exit(f"{tool}: upstream is at {head}, pinned commit is {m['commit']}")
    dest = THIRD_PARTY / tool
    if dest.exists():
        shutil.rmtree(dest)
    (dest / "src").mkdir(parents=True)
    shutil.copy2(src / "LICENSE", dest / "LICENSE")

    lines = [
        f"tool: {tool}",
        f"repo: {m['repo']}",
        f"commit: {m['commit']}",
        f"licence: {m['licence']}",
        f"borrow_register: {m['register']}",
        "status: vendored-verbatim  # not reviewed, not modified, not wired into the build",
        "features:",
    ]
    refusals = []
    for fid, (paths, target, task) in m["features"].items():
        lines += [f"  {fid}:", f"    task: EB-{task}", f"    target: {target}", "    review: pending",
                  "    files:"]
        for rel in paths:
            for f in iter_files(src, rel):
                why = refused(f)
                if why:
                    refusals.append(f"{f}  ({why})")
                    continue
                out = dest / "src" / f
                out.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src / f, out)
                digest = hashlib.sha256(out.read_bytes()).hexdigest()[:16]
                lines.append(f"      - {{path: {f}, sha256: {digest}}}")
    lines.append("refused:" if refusals else "refused: []")
    lines += [f"  - {r}" for r in refusals]
    (dest / "UPSTREAM.yaml").write_text("\n".join(lines) + "\n")
    print(f"{tool}: vendored at {head[:10]}; refused {len(refusals)} path(s)")


if __name__ == "__main__":
    root = Path(sys.argv[1]).resolve()
    for t in sys.argv[2:] or MANIFESTS:
        vendor(t, root)
