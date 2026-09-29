"""Client-bundle leak gate: tenant data must never be shipped to the browser.

Owner task: EB-98 Accessibility, responsive and end-to-end UI tests in CI
After `next build`, greps the client-side chunks (`.next/static`) of apps/web and apps/admin for strings that exist
only in tenant data (demo ledger rows, decisions, canary tokens, operator corpus). Those strings legitimately appear
in the server output (`.next/server`); finding one in `.next/static` means a server-only module was pulled into a
client component. A control check confirms the strings really are in the server build, so the gate cannot pass
vacuously.

Usage: python ops/ci/check_client_bundle.py   (run after `pnpm -r build`)
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CANARIES = ["CANARY-7f3e", "We prefer the HPL panels", "VS/2026/118", "Makrana", "ISMB 600", "accounts@studio8.example", "Ticket 4821"]
APPS = ["apps/web", "apps/admin"]


def contains(root: Path, needle: str) -> list[str]:
    hits = []
    for f in root.rglob("*"):
        if f.is_file() and f.suffix in {".js", ".mjs", ".json", ".html", ".txt", ".map", ""}:
            try:
                if needle.encode() in f.read_bytes():
                    hits.append(str(f.relative_to(REPO)))
            except OSError:
                continue
    return hits


def main() -> int:
    errors: list[str] = []
    checked = 0
    for app in APPS:
        static, server = REPO / app / ".next" / "static", REPO / app / ".next" / "server"
        if not static.is_dir():
            errors.append(f"{app}: no .next/static — run `pnpm -r build` first")
            continue
        for needle in CANARIES:
            checked += 1
            leaked = contains(static, needle)
            if leaked:
                errors.append(f"{app}: '{needle}' is in the client bundle: {leaked[:3]}")
    # control: the strings must exist somewhere in a server build, or this gate proves nothing
    server_total = sum(len(contains(REPO / a / ".next" / "server", c)) for a in APPS for c in CANARIES if (REPO / a / ".next" / "server").is_dir())
    if not errors and server_total == 0:
        errors.append("control failed: none of the canary strings appear in the server build, so this check is vacuous")
    for e in errors:
        print(f"error: {e}")
    print(f"client-bundle check: {checked} strings x {len(APPS)} apps, {len(errors)} error(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
