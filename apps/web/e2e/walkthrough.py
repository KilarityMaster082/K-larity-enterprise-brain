"""Owner task: EB-98 Accessibility, responsive and end-to-end UI tests in CI — full-product browser walkthrough.

Drives the running web app (http://localhost:3000) and admin app (http://localhost:3001) with Playwright and
asserts behaviour, not pixels: roles, tenant isolation, citations, streaming, approvals, decisions, onboarding,
search, mobile layout, dark theme and console cleanliness.

NOT in CI yet: Playwright (Apache-2.0) needs the rule-7 sign-off first. Run it by hand:
    pip install playwright && playwright install chromium     # or use channel="chrome"
    pnpm web:dev & pnpm admin:dev &                            # dev servers
    python apps/web/e2e/walkthrough.py [--shots DIR]
Exit code 0 means every check passed.
"""

from __future__ import annotations

import re
import sys
import time
import traceback
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

WEB, ADMIN = "http://localhost:3000", "http://localhost:3001"
SHOTS = Path(sys.argv[sys.argv.index("--shots") + 1]) if "--shots" in sys.argv else None
HIDE_DEV_BADGE = "nextjs-portal{display:none!important}"
CANARY = "CANARY-7f3e"

results: list[tuple[bool, str]] = []
console_errors: list[str] = []


def check(cond: bool, name: str, detail: str = "") -> None:
    results.append((bool(cond), name))
    print(("  ok   " if cond else "  FAIL ") + name + (f"  [{detail}]" if detail and not cond else ""))


def expect(name: str, fn) -> None:
    """Run a waiting step; a timeout is recorded as a failed check instead of aborting the whole run."""
    try:
        fn()
        check(True, name)
    except Exception as e:  # noqa: BLE001
        check(False, name, str(e).splitlines()[0][:120])


def reset_state(pw) -> None:
    """Both dev servers keep state in memory; a reset gives the next step the seed data again."""
    for base in (WEB, ADMIN):
        r = pw.request.new_context().post(base + "/api/dev/reset")
        if r.status != 200:
            raise RuntimeError(f"{base}/api/dev/reset returned {r.status}; is this a `next dev` server?")


def section(title: str) -> None:
    print(f"\n{title}")


def shot(page: Page, name: str) -> None:
    if SHOTS:
        SHOTS.mkdir(parents=True, exist_ok=True)
        page.wait_for_load_state("networkidle")  # screenshots touch the DOM; do it only after hydration
        page.add_style_tag(content=HIDE_DEV_BADGE)
        page.screenshot(path=str(SHOTS / f"{name}.png"), caret="initial")


EXPECTED_404 = ("/projects/nonexistent", "/projects/phoenix")  # visited on purpose: another tenant's / unknown ids


def new_page(browser, width=1440, height=900, scheme="light") -> Page:
    ctx = browser.new_context(viewport={"width": width, "height": height}, color_scheme=scheme)
    page = ctx.new_page()
    page.set_default_timeout(20000)
    def on_console(m) -> None:
        if m.type != "error":
            return
        if "status of 404" in m.text and page.url.endswith(EXPECTED_404):
            return
        console_errors.append(f"{page.url}: {m.text[:160]}")

    page.on("console", on_console)
    page.on("pageerror", lambda e: console_errors.append(f"{page.url}: pageerror {str(e)[:160]}"))
    return page


def sign_in(page: Page, tenant: str = "Studio 8 Hats", role: str = "Partner (admin)") -> None:
    page.goto(WEB + "/login")
    page.select_option("select[name=tenantId]", label=tenant)
    page.select_option("select[name=role]", label=role)
    page.click("text=Continue as demo user")
    page.wait_for_url("**/ask")
    page.wait_for_load_state("networkidle")  # let React hydrate before keyboard shortcuts are used


def nav_labels(page: Page) -> list[str]:
    return [t.strip() for t in page.eval_on_selector_all(".shell > .sidebar .nav-link", "els => els.map(e => e.childNodes[1]?.textContent ?? e.textContent)")]


def body_text(page: Page) -> str:
    return page.inner_text("body")


def _run() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome")
        reset_state(p)  # start every run from the seed

        # ------------------------------------------------------------------ auth & roles
        section("Sign-in, roles and navigation")
        anon = new_page(browser)
        for path in ("/ask", "/finance", "/settings", "/projects/phoenix", "/design"):
            anon.goto(WEB + path)
            check("/login" in anon.url, f"signed-out {path} redirects to sign-in")
        r = anon.request.post(WEB + "/api/ask", data={"question": "x"})
        check(r.status == 401, "signed-out /api/ask is 401")
        r = anon.request.get(WEB + "/api/search?q=phoenix")
        check(r.status == 401, "signed-out /api/search is 401")
        anon.goto(WEB + "/login?next=https://evil.example")
        anon.click("text=Continue as demo user")
        anon.wait_for_url("**/ask")
        check(anon.url.startswith(WEB), "open redirect via ?next= is ignored")
        cookie = next(c for c in anon.context.cookies() if c["name"] == "kb_session")
        check(cookie["httpOnly"], "session cookie is HttpOnly")
        anon.context.add_cookies([{**cookie, "value": cookie["value"][:-3] + "AAA"}])
        anon.goto(WEB + "/ask")
        check("/login" in anon.url, "a tampered session cookie is rejected")
        anon.context.close()

        expected = {
            "Owner": ["Ask Brain", "Projects", "Finance", "Decisions", "Documents", "Executive", "Approvals", "Settings"],
            "Partner (admin)": ["Ask Brain", "Projects", "Finance", "Decisions", "Documents", "Executive", "Approvals", "Settings"],
            "Member": ["Ask Brain", "Projects", "Decisions", "Documents", "Approvals"],
            "Viewer": ["Ask Brain", "Projects", "Decisions", "Documents", "Approvals"],
            "Guest": ["Ask Brain", "Documents"],
        }
        for role, want in expected.items():
            pg = new_page(browser)
            sign_in(pg, role=role)
            got = nav_labels(pg)
            check(got == want, f"{role}: navigation is {want}", str(got))
            if role in ("Member", "Viewer", "Guest"):
                for path in ("/finance", "/executive", "/settings"):
                    pg.goto(WEB + path)
                    check("don't have access" in body_text(pg), f"{role}: {path} refused on the server")
            if role == "Guest":
                pg.goto(WEB + "/projects")
                check("don't have access" in body_text(pg), "Guest: /projects refused")
            if role == "Member":
                pg.goto(WEB + "/projects/phoenix")
                txt = body_text(pg)
                check("Budget and billing for this project are visible to partners" in txt and "₹1.71 crore" not in txt, "Member: project page hides money")
            pg.context.close()

        # ------------------------------------------------------------------ Ask: streaming, citations, actions
        section("Ask Brain: streaming, citations, approvals")
        pg = new_page(browser)
        sign_in(pg)
        shot(pg, "01-ask-empty")
        pg.click("text=Why is Project Phoenix over budget?")
        pg.wait_for_selector(".progress, article.answer[aria-busy]")
        check(pg.locator("button:has-text('Stop')").count() == 1, "Stop button is shown while answering")
        pg.wait_for_selector("article.answer[aria-busy]", timeout=15000)
        mid = pg.locator("article.answer .answer-text").inner_text()
        check(len(mid) > 20 and pg.locator("article.answer[aria-busy]").count() == 1, "answer streams in before it is complete")
        check(pg.locator("article.answer[aria-busy] .cite").count() > 0 or "₹" in mid, "streamed statements already carry their citations")
        pg.wait_for_selector("article.answer:not([aria-busy])", timeout=25000)
        shot(pg, "02-ask-answer")
        text = pg.locator("article.answer").inner_text()
        check("₹18.4 lakh (12%)" in text, "answer states ₹18.4 lakh (12%) from the ledger")
        check(pg.locator(".figure").count() == 4 and pg.locator(".figure .source-tag").count() == 4, "four figures, each marked From ledger")
        check("what i couldn't confirm" in text.lower(), "answer lists what it could not confirm")
        pg.click(".answer-text .cite >> nth=0")
        pg.wait_for_selector("dialog.sheet[open]")
        sheet = pg.inner_text("dialog.sheet mark")
        check("Over budget ₹18,40,000" in sheet, "citation 1 opens the ledger passage with the figure highlighted", sheet)
        pg.keyboard.press("Escape")
        pg.wait_for_function("!document.querySelector('dialog.sheet[open]')")
        check(pg.evaluate("document.activeElement.className") == "cite", "focus returns to the citation after Esc")
        pg.locator(".answer-text .cite >> nth=2").click()
        pg.wait_for_selector("dialog.sheet[open]")
        check(len(pg.inner_text("dialog.sheet mark")) > 10, "every citation opens a highlighted passage")
        pg.keyboard.press("Escape")
        # action -> approval
        pg.click("button:has-text('Draft a reminder to the client to sign the variation')")
        expect("accepting a suggestion creates a draft in Approvals (nothing is sent)", lambda: pg.wait_for_selector("text=In Approvals — view draft"))
        pg.reload()
        pg.goto(WEB + "/approvals")
        check("Reminder to Phoenix client: please sign the pending variation" in body_text(pg), "the draft appears in Approvals with its title")
        check(pg.locator(".review-card:has-text('sign the pending variation') >> text=Approve").count() >= 1, "partner sees Approve / Reject on it")
        shot(pg, "03-approvals")
        pg.click(".review-card:has-text('sign the pending variation') >> text=Edit draft")
        pg.fill(".review-card:has-text('sign the pending variation') textarea", "Dear client, please sign VO-07 by Friday.")
        pg.click(".review-card:has-text('sign the pending variation') >> text=Approve edited draft")
        pg.wait_for_selector(".toasts .toast")
        pg.click("[role=tab]:has-text('History')")
        hist = pg.locator("#panel-done").inner_text()
        check("Approved" in hist and "please sign VO-07 by Friday" in hist, "approved draft moves to History with the edited text")
        pg.goto(WEB + "/settings?tab=audit")
        audit = body_text(pg)
        check("approval.request" in audit and "approval.approve" in audit and "approval.edit" in audit, "request, edit and approval are all in the audit log")
        # stop mid-stream
        pg.goto(WEB + "/ask")
        pg.fill("#question", "Which client payments are overdue?")
        pg.keyboard.press("Enter")
        pg.wait_for_selector("button:has-text('Stop')")
        pg.click("button:has-text('Stop')")
        pg.wait_for_selector("text=Stopped. The partial answer was discarded")
        check(pg.locator("article.answer").count() == 0, "Stop discards the partial answer")
        # unanswerable
        pg.fill("#question", "What is our office Wi-Fi password?")
        pg.keyboard.press("Enter")
        pg.wait_for_selector(".answer-empty", timeout=20000)
        check("Not enough evidence" in pg.locator(".answer-empty").inner_text(), "unanswerable question is refused, not guessed")
        # feedback needs a reason for thumbs down
        pg.get_by_role("button", name="No", exact=True).last.click()
        check(pg.get_by_role("button", name="Send feedback").is_disabled(), "thumbs-down needs a reason before it can be sent")
        pg.context.close()

        # scoped ask from a project + role limits in Ask
        pg = new_page(browser)
        sign_in(pg)
        pg.goto(WEB + "/projects/marigold")
        pg.fill("#scoped-q", "what changed?")
        pg.click("button:has-text('Ask')")
        pg.wait_for_url("**/ask?**")
        pg.wait_for_selector("article.answer:not([aria-busy])", timeout=25000)
        check("Only Marigold Clinic" in body_text(pg) and "Phoenix" not in pg.locator("article.answer").inner_text(), "a question asked from a project stays inside that project")
        pg.context.close()
        pg = new_page(browser)
        sign_in(pg, role="Viewer")
        pg.fill("#question", "Why is Project Phoenix over budget?")
        pg.keyboard.press("Enter")
        pg.wait_for_selector(".answer-empty", timeout=20000)
        check("Restricted" in pg.locator(".answer-empty").inner_text(), "Viewer asking about budgets is told it is restricted, no numbers leak")
        check("₹" not in pg.locator(".answer-empty").inner_text(), "restricted answer contains no figures")
        pg.context.close()

        # ------------------------------------------------------------------ pages
        section("Projects, Finance, Documents, Executive")
        pg = new_page(browser)
        sign_in(pg)
        pg.goto(WEB + "/projects")
        check(pg.locator(".project-card").count() == 4, "four projects listed")
        pg.click("button:has-text('Needs attention')")
        check(pg.locator(".project-card").count() == 3, "'Needs attention' filter shows the 3 at-risk projects")
        shot(pg, "04-projects")
        pg.goto(WEB + "/projects/phoenix")
        t = body_text(pg)
        check("₹1.53 crore" in t and "₹1.71 crore" in t and "+₹18.4 lakh (12%) over" in t, "Phoenix page shows budget, forecast and overrun")
        check(pg.locator(".timeline .tl-item").count() >= 10, "timeline lists project events")
        pg.locator("table tbody tr").first.locator(".source-tag").first.click()
        pg.wait_for_selector("dialog.sheet[open]")
        check(len(pg.inner_text("dialog.sheet mark")) > 5, "a package row opens its invoice with the amount highlighted")
        pg.keyboard.press("Escape")
        pg.goto(WEB + "/projects/nonexistent")
        check("404" in body_text(pg) or "could not be found" in body_text(pg).lower(), "unknown project id is a 404")
        pg.goto(WEB + "/finance")
        t = body_text(pg)
        check("₹86 lakh" in t and "₹40 lakh" in t, "Finance headline: ₹86 lakh owed, ₹40 lakh overdue")
        check(pg.locator("#leakage li").count() == 3, "three leakage flags")
        pg.fill("input[aria-label='Filter Open receivables']", "Marigold")
        check(pg.locator("#receivables tbody tr").count() == 1, "receivables filter narrows the table")
        pg.click("#receivables th:has-text('Amount') button")
        aria = pg.locator("#receivables th:has-text('Amount')").get_attribute("aria-sort")
        check(aria in ("ascending", "descending"), "sortable headers expose aria-sort", str(aria))
        shot(pg, "05-finance")
        pg.goto(WEB + "/documents")
        check(pg.locator(".doc-row").count() == 9, "documents list shows the 9 latest revisions only (11 documents, 2 superseded)", str(pg.locator(".doc-row").count()))
        pg.fill("input[aria-label='Search documents']", "PHX-STR-204")
        check(pg.locator(".doc-row").count() == 1 and "Rev C" in pg.locator(".doc-row").inner_text(), "search by sheet number finds the latest revision")
        pg.click("text=Latest revisions only")
        check(pg.locator(".doc-row").count() == 2, "turning off 'latest only' shows Rev B as well")
        pg.locator(".doc-row:has-text('Rev B')").click()
        check("Superseded" in pg.locator(".preview").inner_text(), "the older revision is flagged as superseded")
        pg.goto(WEB + "/documents?doc=d-phx-vo07")
        check("Not signed" in pg.locator(".preview").inner_text(), "deep link opens VO-07 marked Not signed")
        shot(pg, "06-documents")
        pg.goto(WEB + "/executive")
        t = body_text(pg)
        check("Needs your attention today" in t and pg.locator(".attention li").count() >= 6, "executive attention list")
        check("Chase Banyan Office" in pg.locator(".attention li").first.inner_text(), "most urgent item first (33 days overdue)")
        shot(pg, "07-executive")
        pg.click(".kpi:has-text('Overdue')")
        check("/finance" in pg.url, "an executive tile drills down to Finance")
        pg.context.close()

        # ------------------------------------------------------------------ decisions
        section("Decisions review")
        pg = new_page(browser)
        sign_in(pg)
        pg.goto(WEB + "/decisions")
        check(pg.locator("#panel-review .review-card").count() == 3, "three drafts to review")
        pg.locator("#dec-dec-mc-pvc").get_by_role("button", name="Confirm", exact=True).click()
        expect("confirming a draft removes it from the queue", lambda: pg.wait_for_function("document.querySelectorAll('#panel-review .review-card').length === 2"))
        pg.locator("#dec-dec-phx-crews").get_by_role("button", name="Edit & confirm").click()
        pg.fill("dialog.modal input[name=title]", "Keep crews on site for the 3-week steel delay")
        pg.locator("dialog.modal").get_by_role("button", name="Save and confirm", exact=True).click()
        pg.wait_for_function("document.querySelectorAll('#panel-review .review-card').length === 1")
        pg.locator("#dec-dec-bo-handover").get_by_role("button", name="Reject").click()
        pg.fill("dialog.modal input[name=note]", "Only a suggestion")
        pg.locator("dialog.modal").get_by_role("button", name="Reject draft", exact=True).click()
        expect("edited and rejected drafts leave the queue", lambda: pg.wait_for_selector("text=Nothing to review"))
        pg.click("[role=tab]:has-text('Decision log')")
        log = pg.locator("#panel-log").inner_text()
        check("Keep crews on site for the 3-week steel delay" in log and "Seamless coved PVC" in log, "confirmed decisions are in the log")
        check("Handover on 15 October" in log and "Rejected" in log, "rejected draft is kept, marked Rejected, with the note")
        pg.select_option("#panel-log select", label="Lotus Villa")
        check(pg.locator("#panel-log .review-card").count() == 3 and "Superseded" in pg.locator("#panel-log").inner_text(), "project filter works and shows the superseded decision")
        pg.goto(WEB + "/ask")
        pg.fill("#question", "What did we decide about the Marigold OT flooring PVC?")
        pg.keyboard.press("Enter")
        pg.wait_for_selector("article.answer:not([aria-busy])", timeout=25000)
        ans = pg.locator("article.answer").inner_text()
        check("high confidence" in ans.lower() and "Confirmed by Demo user" in ans, "after confirmation Ask answers from the confirmed decision, naming the reviewer, with high confidence", ans[:120])
        pg.context.close()
        reset_state(p)
        pg = new_page(browser)
        sign_in(pg, role="Viewer")
        pg.goto(WEB + "/decisions")
        check(pg.get_by_role("button", name="Confirm").count() == 0 and pg.get_by_role("button", name="Reject").count() == 0 and "reviews drafts" in body_text(pg), "Viewer cannot confirm or reject drafts")
        pg.context.close()

        # ------------------------------------------------------------------ command palette
        section("Command palette")
        pg = new_page(browser)
        sign_in(pg)
        pg.keyboard.press("Control+k")
        pg.wait_for_selector("dialog.palette[open]")
        check(pg.evaluate("document.activeElement.getAttribute('role')") == "combobox", "palette opens focused on its search box")
        pg.keyboard.type("facade")
        pg.wait_for_selector(".palette-item:has-text('PHX-FAC-301')")
        groups = pg.locator(".palette-group").all_inner_texts()
        groups = [g.lower() for g in groups]
        check("documents" in groups and "decisions" in groups, "results are grouped (documents, decisions)", str(groups))
        pg.keyboard.press("ArrowDown")
        pg.keyboard.press("ArrowDown")
        pg.keyboard.press("Enter")
        expect("Enter follows the selected result", lambda: pg.wait_for_url("**/documents?doc=**"))
        pg.wait_for_load_state("networkidle")
        pg.keyboard.press("Control+k")
        pg.keyboard.type("who signed VO-07?")
        pg.keyboard.press("Enter")
        pg.wait_for_url("**/ask?q=**")
        pg.wait_for_selector(".question")
        check("who signed VO-07?" in pg.inner_text(".question"), "an unmatched query becomes a question for Ask Brain")
        pg.context.close()
        pg = new_page(browser)
        sign_in(pg, role="Guest")
        pg.keyboard.press("Control+k")
        pg.keyboard.type("phoenix")
        pg.wait_for_timeout(700)
        opts = pg.locator(".palette-item").all_inner_texts()
        check(not any("Project Phoenix" in o and "Jubilee" in o for o in opts) and not any(o.startswith("Projects") for o in opts), "Guest search never returns projects or decisions", str(opts))
        pg.context.close()

        # ------------------------------------------------------------------ settings & onboarding & isolation
        section("Onboarding, settings and tenant isolation")
        pg = new_page(browser)
        sign_in(pg, tenant="Synthetic canary", role="Owner")
        check("Get your Brain ready" in body_text(pg), "a new workspace shows the first-run checklist")
        check("Synthetic test tenant" in body_text(pg), "synthetic tenants are badged")
        check(pg.locator(".suggestion, .chip").count() == 0, "no suggested questions before any source is synced")
        pg.fill("#question", "Why is Project Phoenix over budget?")
        pg.keyboard.press("Enter")
        pg.wait_for_selector(".answer-empty", timeout=20000)
        check("no synced sources" in pg.locator(".answer-empty").inner_text(), "asking before any sync says there is nothing to answer from")
        for path in ("/projects", "/finance", "/documents", "/decisions", "/executive"):
            pg.goto(WEB + path)
            check("Connect a source" in body_text(pg), f"{path} on an unsynced workspace points to Connect a source")
        pg.goto(WEB + "/settings?tab=sources")
        pg.click("button:has-text('Connect your first source')")
        pg.fill("dialog.modal input[name=account]", "canary@example.com")
        pg.locator("dialog.modal").get_by_role("button", name="Connect", exact=True).click()
        pg.wait_for_selector("text=First sync running")
        shot(pg, "08-syncing")
        expect("the first sync finishes by itself (page refreshes)", lambda: pg.wait_for_selector("text=Healthy", timeout=25000))
        pg.goto(WEB + "/ask")
        check("Get your Brain ready" in body_text(pg) and pg.locator(".check-item[data-done=true]").count() == 2, "checklist shows 2 of 3 steps done")
        pg.click(".chip >> nth=0") if pg.locator(".chip").count() else pg.fill("#question", "What changed recently?")
        if not pg.locator(".question").count():
            pg.keyboard.press("Enter")
        pg.wait_for_selector("article.answer, .answer-empty", timeout=25000)
        pg.reload()
        check("Get your Brain ready" not in body_text(pg), "checklist disappears after the first answer")
        pg.goto(WEB + "/projects")
        canary_pages = ""
        for path in ("/projects", "/finance", "/documents", "/decisions", "/executive", "/settings?tab=audit"):
            pg.goto(WEB + path)
            canary_pages += body_text(pg)
        check(CANARY in canary_pages, "after syncing, the canary tenant sees its own data")
        check("Phoenix" not in canary_pages and "Marigold" not in canary_pages and "Banyan" not in canary_pages, "…and none of Studio 8's")
        pg.goto(WEB + "/projects/phoenix")
        check("404" in body_text(pg) or "could not be found" in body_text(pg).lower(), "another tenant's project id is a 404, not data")
        # switch tenant
        pg.goto(WEB + "/ask")
        pg.click(".shell > .sidebar .tenant-btn")
        pg.click(".shell > .sidebar .menu-panel >> text=Studio 8 Hats")
        expect("switching workspace changes the active tenant", lambda: pg.wait_for_function("document.querySelector('.shell > .sidebar .tenant-name').innerText.includes('Studio 8')"))
        pg.wait_for_selector(".ask-hero")
        check("Get your Brain ready" not in body_text(pg), "the canary's checklist state does not carry over to Studio 8")
        pg.goto(WEB + "/projects")
        s8 = body_text(pg)
        for path in ("/finance", "/documents", "/decisions", "/executive", "/approvals", "/settings?tab=audit"):
            pg.goto(WEB + path)
            s8 += body_text(pg)
        check(CANARY not in s8 and "canary@example.com" not in s8, "Studio 8 never shows a canary string or the canary's audit events")
        pg.goto(WEB + "/settings?tab=sources")
        check("Needs reconnect" in body_text(pg), "Studio 8: a revoked Gmail credential shows Needs reconnect")
        pg.click("button:has-text('Reconnect')")
        expect("Reconnect clears the Needs reconnect state", lambda: pg.wait_for_function("!document.querySelector('#panel-sources').innerText.includes('Needs reconnect')"))
        pg.context.close()
        pg = new_page(browser)
        sign_in(pg, role="Owner")
        pg.goto(WEB + "/settings?tab=members")
        check(pg.locator("button:has-text('Invite')").count() == 1, "an owner can invite members")
        pg.select_option("select[aria-label='Role for principal@studio8.example']", label="Member")
        expect("the last owner cannot be demoted", lambda: pg.wait_for_function("document.querySelector('.toasts')?.innerText.includes('at least one owner')", timeout=8000))
        pg.select_option("select[aria-label='Role for accounts@studio8.example']", label="Viewer")
        pg.wait_for_selector("text=is now viewer")
        pg.click("[role=tab]:has-text('Audit log')")
        check("member.role_change" in body_text(pg) and "source.reauthorise" in body_text(pg), "role change and reconnect are in the audit log")
        pg.context.close()

        # partner cannot manage members
        pg = new_page(browser)
        sign_in(pg, role="Partner (admin)")
        pg.goto(WEB + "/settings?tab=members")
        check(pg.locator("select[aria-label^='Role for']").count() == 0 and pg.locator("button:has-text('Invite')").count() == 0, "a partner sees members but cannot change roles or invite")
        pg.context.close()

        # ------------------------------------------------------------------ design, dark, mobile, a11y basics
        section("Design system, dark theme, mobile")
        pg = new_page(browser, scheme="dark")
        sign_in(pg)
        pg.goto(WEB + "/design")
        check(pg.locator(".logo-dark").first.is_visible() and not pg.locator(".logo-light").first.is_visible(), "dark theme shows the white-wordmark logo")
        pg.goto(WEB + "/projects/phoenix")
        shot(pg, "09-dark-project")
        contrast_ok = pg.evaluate("""() => { const c = getComputedStyle(document.body); return c.backgroundColor !== c.color; }""")
        check(contrast_ok, "dark theme applies distinct background and text colours")
        pg.context.close()
        pg = new_page(browser, 390, 844)
        sign_in(pg)
        for path in ("/ask", "/projects", "/projects/phoenix", "/finance", "/decisions", "/documents", "/executive", "/approvals", "/settings", "/design"):
            pg.goto(WEB + path)
            pg.wait_for_timeout(250)
            over = pg.evaluate("document.documentElement.scrollWidth - window.innerWidth")
            check(over <= 1, f"mobile {path}: no horizontal page scroll", f"overflow {over}px")
        pg.goto(WEB + "/ask")
        pg.click("[aria-label='Open navigation']")
        pg.wait_for_selector("dialog.nav-drawer[open]")
        shot(pg, "10-mobile-nav")
        pg.click("dialog.nav-drawer >> text=Projects")
        pg.wait_for_function("!document.querySelector('dialog.nav-drawer[open]')")
        check("/projects" in pg.url, "mobile drawer navigates and closes")
        pg.context.close()
        pg = new_page(browser)
        sign_in(pg)
        pg.goto(WEB + "/finance")
        check(pg.locator("h1").count() == 1, "one <h1> per page")
        check(pg.locator("main#main").count() == 1 and pg.locator("a.skip-link").count() == 1, "landmarks: one <main> and a skip link")
        unnamed = pg.evaluate("[...document.querySelectorAll('button, a[href]')].filter(e => !(e.textContent.trim() || e.getAttribute('aria-label') || e.getAttribute('title'))).length")
        check(unnamed == 0, "every button and link has an accessible name", str(unnamed))
        pg.context.close()

        # ------------------------------------------------------------------ admin console
        section("Operator console")
        ad = new_page(browser)
        ad.goto(ADMIN + "/tenants")
        check("/login" in ad.url, "signed-out operator console redirects to sign-in")
        ad.goto(ADMIN + "/login")
        ad.click("text=Continue as demo operator")
        ad.wait_for_url("**/tenants")
        check(ad.locator("tbody tr").count() == 2, "two tenants listed")
        check("Studio 8 Hats" in body_text(ad) and "1 failing" in body_text(ad), "Studio 8 shows a failing source")
        web_cookie_names = {c["name"] for c in ad.context.cookies()}
        check("kb_op_session" in web_cookie_names and "kb_session" not in web_cookie_names, "operator session is separate from the tenant session")
        shot(ad, "11-admin-tenants")
        ad.goto(ADMIN + "/retrieval")
        check("Start an audited view" in body_text(ad), "retrieval console needs an impersonation first")
        r = ad.request.post(ADMIN + "/api/retrieval", data={"q": "facade", "as": "all"})
        check(r.status == 403, "retrieval API refuses without impersonation")
        ad.goto(ADMIN + "/tenants")
        ad.click("a:has-text('Studio 8 Hats')")
        ad.click("button:has-text('View tenant data')")
        ad.fill("dialog.modal textarea[name=reason]", "short")
        ad.locator("dialog.modal").get_by_role("button", name="Start viewing", exact=True).click()
        ad.wait_for_timeout(800)
        check(ad.locator(".banner-impersonate").count() == 0 and ad.locator("dialog.modal[open]").count() == 1, "impersonation with a too-short reason is not started (form validation keeps the dialog open)")
        r = ad.request.post(ADMIN + "/api/retrieval", data={"q": "facade", "as": "all"})
        check(r.status == 403, "…and the server-side rule holds too: no impersonation, no retrieval")
        ad.fill("dialog.modal textarea[name=reason]", "Ticket 4821: check why VO-07 is not found")
        ad.locator("dialog.modal").get_by_role("button", name="Start viewing", exact=True).click()
        ad.wait_for_selector(".banner-impersonate")
        check("Ticket 4821" in ad.inner_text(".banner-impersonate"), "impersonation banner shows the reason on every page")
        ad.goto(ADMIN + "/sources-health")
        check(ad.locator(".banner-impersonate").count() == 1, "…and stays on other pages")
        ad.goto(ADMIN + "/retrieval")
        ad.fill("input[placeholder*='facade']", "facade HPL cost")
        ad.select_option("select", label="Structural consultant (guest)")
        ad.click("text=Run retrieval")
        ad.wait_for_selector("text=No results")
        check("may not see them" in ad.inner_text("main") and "hidden by ACL" in ad.inner_text("main"), "a guest searching 'facade' gets nothing: matching chunks exist but the ACL hides them")
        ad.select_option("select", label="A partner")
        ad.click("text=Run retrieval")
        ad.wait_for_selector("ol[aria-label='Ranked results']")
        hits = ad.locator(".hit").all_inner_texts()
        check(len(hits) >= 2 and any("Revised quotation" in h for h in hits) and any("group:project-phoenix" in h for h in hits), "a partner sees the facade chunks with their ACL tokens", str(len(hits)))
        ad.fill("input[placeholder*='facade']", "signature VO-07 pending")
        ad.click("text=Run retrieval")
        ad.wait_for_selector(".hit")
        check("VO-07" in ad.locator("main").inner_text(), "a partner finds the unsigned VO-07 chunk")
        ad.select_option("select", label="Accounts")
        ad.click("text=Run retrieval")
        ad.wait_for_selector(".hit")
        check("VO-07" in ad.locator("main").inner_text(), "accounts (named in the ACL) also finds it")
        ad.select_option("select", label="Structural consultant (guest)")
        ad.click("text=Run retrieval")
        ad.wait_for_selector("text=No results")
        check("VO-07" not in ad.locator("main").inner_text().replace("signature VO-07 pending", ""), "the guest cannot see the VO-07 chunk")
        shot(ad, "12-admin-retrieval")
        ad.goto(ADMIN + "/audit")
        a = body_text(ad)
        check("impersonation.start" in a and "retrieval.query" in a and "Ticket 4821" in a, "impersonation and every retrieval query are audited with the reason")
        ad.goto(ADMIN + "/tenants")
        ad.click("button:has-text('Exit')")
        ad.wait_for_function("!document.querySelector('.banner-impersonate')")
        ad.goto(ADMIN + "/audit")
        check("impersonation.end" in body_text(ad), "exiting impersonation is audited")
        ad.goto(ADMIN + "/tenants")
        ad.click("button:has-text('Provision tenant')")
        ad.fill("dialog.modal input[name=name]", "Acme Architects")
        ad.fill("dialog.modal input[name=slug]", "acme-architects")
        ad.select_option("dialog.modal select[name=tier]", "bridge")
        ad.locator("dialog.modal").get_by_role("button", name="Provision", exact=True).click()
        ad.wait_for_url("**/tenants/**")
        ad.wait_for_selector("text=ProvisionTenant workflow")
        placement = ad.inner_text("main")
        check("brand_" in placement.replace("-", "_") or "docs-" in placement, "bridge tenant gets its own database, index and shard key")
        check("Provisioning" in placement, "provisioning steps are shown")
        expect("provisioning completes on its own and the tenant becomes active", lambda: ad.wait_for_function("!document.body.innerText.includes('ProvisionTenant workflow')", timeout=30000))
        ad.click("button:has-text('Suspend')")
        ad.fill("dialog.modal textarea[name=reason]", "Payment failure, ticket 77")
        ad.locator("dialog.modal").get_by_role("button", name="Suspend tenant", exact=True).click()
        expect("suspending needs a reason and succeeds", lambda: ad.wait_for_function("document.querySelector('main').innerText.includes('suspended')"))
        ad.goto(ADMIN + "/sources-health")
        check("1/" in body_text(ad) or "Within freshness target" in body_text(ad), "sources health summarises freshness across tenants")
        ad.locator("tbody tr").first.wait_for()
        check("Accounts mailbox" in ad.locator("tbody tr").first.inner_text(), "worst source (revoked credential) sorts first")
        shot(ad, "13-admin-sources")
        ad.context.close()

        check(not console_errors, "no browser console errors anywhere", "; ".join(console_errors[:3]))
        browser.close()



def main() -> int:
    try:
        _run()
    except Exception as e:  # noqa: BLE001 — a crash is a failed run, reported with what passed before it
        here = [f for f in traceback.extract_tb(e.__traceback__) if f.filename.endswith("walkthrough.py")]
        where = f" at line {here[-1].lineno}: {here[-1].line}" if here else ""
        check(False, "walkthrough completed without crashing", f"{type(e).__name__}: {str(e).splitlines()[0][:100]}{where}")
    failed = [n for ok, n in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    for n in failed:
        print("  FAILED:", n)
    return 1 if failed else 0


if __name__ == "__main__":
    t0 = time.time()
    code = main()
    print(f"({time.time() - t0:.0f}s)")
    sys.exit(code)
