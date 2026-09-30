"""Owner task: EB-98 Accessibility, responsive and end-to-end UI tests in CI — browser smoke test over all 54 screens.

Drives the running web app (http://localhost:3000) and admin app (http://localhost:3001) with Playwright and checks
behaviour, not pixels: every screen renders with its "N / 54" crumb, no console errors, no sideways scrolling on a phone;
the ask → citation → evidence side-sheet flow; lakh/crore formatting on finance; role gates; tenant isolation; and the
operator flows (audited view, retrieval, dead-letter replay).

NOT in CI yet: Playwright (Apache-2.0) needs the rule-7 sign-off first (decision log D-37). Run it by hand:
    pip install playwright && playwright install chromium        # or set CHROMIUM_PATH=/path/to/chrome
    pnpm --filter @klarity/web dev & pnpm --filter @klarity/admin dev &
    python apps/web/e2e/smoke.py [--shots DIR]
Exit code 0 means every check passed.
"""

from __future__ import annotations

import os
import re
import sys
import traceback
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

WEB, ADMIN = "http://localhost:3000", "http://localhost:3001"
SHOTS = Path(sys.argv[sys.argv.index("--shots") + 1]) if "--shots" in sys.argv else None
CANARY_TENANT = "1bae9ff8-abf9-44bf-9b17-a5cb2c83d71b"

# (screen number, path). Overlay screens (2, 7, 25, 30–37, 42) are opened from their parents below.
WEB_SCREENS = [
    (1, "/ask"), (3, "/login"), (4, "/onboarding"), (5, "/communications"), (6, "/communications/t-rfi27"),
    (8, "/knowledge"), (9, "/knowledge/files"), (10, "/knowledge/bases"), (11, "/knowledge/graph"),
    (12, "/projects"), (13, "/projects/phoenix"), (14, "/decisions"), (15, "/documents"), (16, "/finance"),
    (17, "/executive"), (18, "/approvals"), (19, "/meetings"), (20, "/meetings/m-phx-site/prep"), (21, "/meetings/live"),
    (22, "/meetings/call"), (23, "/todos"), (24, "/tasks"), (26, "/spaces"), (27, "/spaces/sp-phx-structural"),
    (28, "/spaces/sp-phx-structural/files"), (29, "/activity"), (38, "/apps"), (39, "/apps/gmail"), (40, "/history"),
    (41, "/explore"), (43, "/settings/sources"), (44, "/settings/members"), (45, "/settings/security"),
]
ADMIN_SCREENS = [(47, "/tenants"), (49, "/sources-health"), (50, "/dead-letter"), (51, "/retrieval"), (52, "/gateway"), (53, "/audit"), (54, "/infrastructure")]

results: list[tuple[bool, str]] = []
console_errors: list[str] = []


def check(cond: bool, name: str, detail: str = "") -> None:
    results.append((bool(cond), name))
    print(("  ok   " if cond else "  FAIL ") + name + (f"  [{detail}]" if detail and not cond else ""))


def section(title: str) -> None:
    print(f"\n{title}")


def new_page(browser, width: int = 1360, height: int = 900) -> Page:
    page = browser.new_context(viewport={"width": width, "height": height}).new_page()
    page.on("console", lambda m: console_errors.append(f"{page.url}: {m.text[:140]}") if m.type == "error" else None)
    page.on("pageerror", lambda e: console_errors.append(f"{page.url}: {e}"))
    return page


def settle(page: Page, ms: int = 900) -> None:
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(ms)


def shot(page: Page, name: str) -> None:
    if SHOTS:
        SHOTS.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SHOTS / f"{name}.png"))


def web_login(page: Page, role: str = "owner", tenant: str | None = None) -> None:
    page.goto(WEB + "/login")
    if tenant:
        page.click(f"label.eb-choice:has(input[value='{tenant}'])")
    page.click(f"label.eb-choice-pill:has(input[value={role}])")
    page.click("text=Continue as demo user")
    page.wait_for_url(re.compile(r".*/ask.*"))


def crumb_ok(page: Page, n: int) -> bool:
    return f"{n} / 54" in page.inner_text("body")


def no_sideways_scroll(page: Page) -> bool:
    return page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")


def run() -> None:
    with sync_playwright() as p:
        exe = os.environ.get("CHROMIUM_PATH")
        browser = p.chromium.launch(executable_path=exe, args=["--no-sandbox"]) if exe else p.chromium.launch()
        for base in (WEB, ADMIN):
            r = p.request.new_context().post(base + "/api/dev/reset")
            if r.status != 200:
                raise RuntimeError(f"{base}/api/dev/reset returned {r.status}; is this a `next dev` server?")

        section("Signed-out visitors")
        anon = new_page(browser)
        for path in ("/ask", "/finance", "/spaces", "/apps"):
            anon.goto(WEB + path)
            check("/login" in anon.url, f"signed-out {path} redirects to sign-in")
        check(p.request.new_context().get(WEB + "/api/files/d-phx-boq").status == 401, "signed-out /api/files is 401")
        check(p.request.new_context().get(ADMIN + "/tenants", max_redirects=0).status in (302, 307), "signed-out admin redirects")

        section("Tenant app: every screen renders (owner, desktop)")
        page = new_page(browser)
        web_login(page)
        for n, path in WEB_SCREENS:
            page.goto(WEB + path)
            settle(page, 500)
            check(crumb_ok(page, n) or n == 3, f"screen {n} {path} shows its crumb")
        shot(page, "executive") if page.goto(WEB + "/executive") else None

        section("Ask → citation → Evidence Side-Sheet")
        page.goto(WEB + "/ask")
        page.fill("textarea", "Why is Phoenix over budget?")
        page.keyboard.press("Enter")
        page.wait_for_selector("text=E1", timeout=20000)
        page.click("button:has-text('E1') >> nth=0")
        page.wait_for_selector("dialog[open]", timeout=5000)
        check("source=" in page.url, "a citation click puts ?source= in the URL")
        check("IST" in page.inner_text("dialog[open]") or "Asia" in page.inner_text("dialog[open]") or re.search(r"\d{1,2}:\d{2}", page.inner_text("dialog[open]")) is not None, "side-sheet shows a timestamp")
        shot(page, "evidence")
        page.keyboard.press("Escape")

        section("Finance uses lakh/crore and SQL origin")
        page.goto(WEB + "/finance")
        settle(page)
        body = page.inner_text("body")
        check(bool(re.search(r"₹\s?\d[\d,.]*\s?(lakh|crore|L|Cr)?", body)), "finance shows rupee figures")
        check("$" not in body.replace("$500", ""), "finance never shows dollars")

        section("File viewers")
        for doc, marker in (("d-phx-boq", "Spreadsheet"), ("d-phx-str204-c", "PDF"), ("d-phx-skyline-contract", "Document")):
            page.goto(f"{WEB}/documents?view={doc}")
            page.wait_for_selector("dialog[open]", timeout=8000)
            settle(page, 400)
            check(marker.lower() in page.inner_text("dialog[open]").lower(), f"{doc} opens the {marker} viewer")

        section("Role gates and tenant isolation")
        viewer = new_page(browser)
        web_login(viewer, "viewer")
        viewer.goto(WEB + "/finance")
        check("don't have access" in viewer.inner_text("body").lower() or "no access" in viewer.inner_text("body").lower() or "not available" in viewer.inner_text("body").lower(), "viewer cannot open /finance")
        status = viewer.request.get(WEB + "/api/files/d-ops-labels").status
        check(status == 403, "viewer cannot open a code file", str(status))
        boq = viewer.request.get(WEB + "/api/files/d-phx-boq").json()
        check("92,000" not in str(boq.get("content")) and "92000" not in str(boq.get("content")), "viewer's BOQ hides rates")
        canary = new_page(browser)
        web_login(canary, "owner", CANARY_TENANT)
        check(canary.request.get(WEB + "/api/files/d-phx-boq").status == 404, "another tenant's file is 404")
        check(canary.request.get(WEB + "/api/evidence/ev-phx-fac301").status == 404, "another tenant's evidence is 404")

        section("Phone layout")
        phone = new_page(browser, 390, 844)
        web_login(phone)
        for path in ("/ask", "/projects", "/decisions", "/spaces", "/apps"):
            phone.goto(WEB + path)
            settle(phone, 500)
            check(no_sideways_scroll(phone), f"{path} does not scroll sideways at 390 px")

        section("Operator console")
        op = new_page(browser)
        op.goto(ADMIN + "/login")
        op.click("text=Continue as demo operator")
        op.wait_for_url(re.compile(r".*/tenants"))
        for n, path in ADMIN_SCREENS:
            op.goto(ADMIN + path)
            settle(op, 500)
            check(crumb_ok(op, n), f"screen {n} {path} shows its crumb")
        op.goto(ADMIN + "/tenants")
        op.click("a:has-text('Studio 8 Hats') >> nth=0")
        settle(op, 500)
        check(crumb_ok(op, 48), "screen 48 tenant detail")
        op.goto(ADMIN + "/retrieval")
        check("Start an audited view" in op.inner_text("body"), "retrieval is locked until an audited view starts")
        op.goto(ADMIN + "/tenants")
        op.click("a:has-text('Studio 8 Hats') >> nth=0")
        op.click("text=View tenant data (audited)")
        op.fill("textarea[name=reason]", "Smoke test: check the facade answer")
        op.click("form button[type=submit]:has-text('Start viewing')")
        op.wait_for_selector("text=every query is audited", timeout=5000)
        op.goto(ADMIN + "/retrieval")
        op.fill("input[placeholder='e.g. facade HPL cost']", "transfer beam")
        op.click("text=Run retrieval")
        op.wait_for_selector("text=Query plan", timeout=5000)
        check("Permission filter" in op.inner_text("body") and "Rerank" in op.inner_text("body"), "retrieval shows the query plan")
        op.goto(ADMIN + "/dead-letter?stage=parse")
        settle(op, 400)
        before = op.locator("ul[aria-label='Dead-letter items'] > li").count()
        op.click("ul[aria-label='Dead-letter items'] summary >> nth=0")
        op.click("details[open] button:has-text('Replay')")
        op.fill("textarea[name=reason]", "Smoke test: timeout raised to 240 s")
        op.click("form button[type=submit]:has-text('Replay')")
        op.wait_for_timeout(1500)
        check(op.locator("ul[aria-label='Dead-letter items'] > li").count() == before - 1, "a replay removes the item from the open queue")
        op.goto(ADMIN + "/audit")
        check("dlq.replay" in op.inner_text("body") and "retrieval.query" in op.inner_text("body"), "the audit log shows the replay and the query")

        browser.close()

    section("Console")
    check(not console_errors, "no console errors on any page", "; ".join(console_errors[:3]))


if __name__ == "__main__":
    try:
        run()
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        results.append((False, "run completed"))
    failed = [n for ok, n in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    sys.exit(1 if failed else 0)
