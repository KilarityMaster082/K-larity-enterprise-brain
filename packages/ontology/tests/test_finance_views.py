# Owner task: EB-55 Financial Brain page
"""The finance views are the only source of rupee figures on the Finance and Executive screens (CLAUDE.md rule 3).

Static checks always run. The PostgreSQL checks run when KLARITY_TEST_PG_URL points at a server (any database on it;
the test creates and drops its own scratch database): they load db/seed/finance_equivalence.json, written by
apps/web/tests/finance-sql.test.ts from the web app's derivations, run db/views/finance.sql on the same rows as the
NOBYPASSRLS application role, and require the views to return exactly what the web app computes, and nothing of
another tenant.

    KLARITY_TEST_PG_URL=postgresql://user:pass@localhost:5432/postgres python -m pytest packages/ontology/tests/test_finance_views.py
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
import uuid
from urllib.parse import urlparse, urlunparse

import pytest

REPO = Path(__file__).resolve().parents[3]
VIEWS = REPO / "db" / "views" / "finance.sql"
FIXTURE = REPO / "db" / "seed" / "finance_equivalence.json"
PG_URL = os.environ.get("KLARITY_TEST_PG_URL")


# ---------------------------------------------------------------- static
def test_views_file_is_owned_and_isolated_by_construction() -> None:
    sql = VIEWS.read_text()
    assert "Owner task: EB-55" in sql[:200]
    assert "SECURITY DEFINER" not in sql.upper(), "a definer function would bypass the caller's row-level security"
    views = re.findall(r"CREATE OR REPLACE VIEW (\w+) WITH \(security_invoker = true\)", sql)
    assert len(views) == len(re.findall(r"CREATE OR REPLACE VIEW", sql)), "every view must be security_invoker"
    assert {"finance_txn", "finance_variance_by_package", "finance_project_summary", "finance_leakage_flags"} <= set(views)
    funcs = re.findall(r"CREATE OR REPLACE FUNCTION (\w+)\(", sql)
    assert len(funcs) == len(re.findall(r"STABLE SECURITY INVOKER", sql))
    assert {"finance_open_receivables", "finance_receivables_ageing", "finance_payables_due", "finance_cash_position",
            "finance_cash_monthly", "finance_executive_summary"} <= set(funcs)


def test_budget_lines_migration_enforces_tenant_isolation() -> None:
    up = (REPO / "db/migrations/0005_finance_budget_lines.sql").read_text()
    assert re.search(r"tenant_id\s+text\s+NOT\s+NULL", up)
    assert "FORCE  ROW LEVEL SECURITY" in up
    assert "FOREIGN KEY (tenant_id, project_id)" in up
    assert "finance_budget_lines_tenant_isolation" in up
    down = (REPO / "db/migrations/0005_finance_budget_lines.down.sql").read_text()
    assert "DROP TABLE IF EXISTS finance_budget_lines" in down


def test_equivalence_fixture_has_two_tenants_and_expected_figures() -> None:
    doc = json.loads(FIXTURE.read_text())
    assert len(doc["tenants"]) == 2
    for t in doc["tenants"].values():
        assert {"projects", "budgetLines", "txns", "contracts", "expected"} <= set(t)


# ---------------------------------------------------------------- PostgreSQL
def _psql(url: str, *args: str, sql: str | None = None, check: bool = True) -> str:
    cmd = ["psql", url, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", *args]
    res = subprocess.run(cmd, input=sql, capture_output=True, text=True)
    if check and res.returncode != 0:
        raise AssertionError(f"psql failed: {res.stderr.strip()}\n{sql or args}")
    return res.stdout


def _lit(v: object) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def _load(url: str, doc: dict) -> None:
    out: list[str] = []
    for tid, t in doc["tenants"].items():
        for p in t["projects"]:
            out.append(f"INSERT INTO projects (tenant_id, project_id, name, budget) VALUES ({_lit(tid)}, {_lit(p['projectId'])}, {_lit(p['name'])}, {_lit(p['budget'])});")
        for b in t["budgetLines"]:
            out.append(f"INSERT INTO finance_budget_lines (tenant_id, project_id, package, budget) VALUES ({_lit(tid)}, {_lit(b['projectId'])}, {_lit(b['package'])}, {_lit(b['budget'])});")
        for x in t["txns"]:
            meta = json.dumps({"direction": x["direction"], "package": x["package"], "counterparty": x["counterparty"]})
            out.append(
                "INSERT INTO finance_txns (tenant_id, txn_id, project_id, txn_type, txn_ref, amount, status, txn_date, due_date, source_ref, metadata) VALUES "
                f"({_lit(tid)}, {_lit(x['txnId'])}, {_lit(x['projectId'])}, {_lit(x['txnType'])}, {_lit(x['txnRef'])}, {_lit(x['amount'])}, {_lit(x['status'])}, "
                f"{_lit(x['txnDate'])}, {_lit(x['dueDate'])}, {_lit(x['evidenceId'])}, {_lit(meta)}::jsonb);"
            )
        for d in t["contracts"]:
            meta = json.dumps({k: v for k, v in {"signed": None if d["signed"] is None else str(d["signed"]).lower(), "amount": d["amount"]}.items() if v is not None})
            out.append(
                "INSERT INTO documents (tenant_id, document_id, project_id, title, doc_type, storage_ref, content_hash, metadata) VALUES "
                f"({_lit(tid)}, {_lit(d['documentId'])}, {_lit(d['projectId'])}, {_lit(d['title'])}, 'contract', 's3://test', 'sha256:{'0' * 64}', {_lit(meta)}::jsonb);"
            )
    _psql(url, sql="\n".join(out))


@pytest.fixture(scope="module")
def db():
    if not PG_URL:
        pytest.skip("set KLARITY_TEST_PG_URL to run the PostgreSQL view checks")
    u = urlparse(PG_URL)
    name = f"klarity_fin_{uuid.uuid4().hex[:10]}"
    admin = PG_URL
    scratch = urlunparse(u._replace(path=f"/{name}"))
    _psql(admin, "-c", f"CREATE DATABASE {name}")
    try:
        for f in ("db/migrations/0001_initial.sql", "db/policies/tenant.sql", "db/policies/roles.sql", "db/migrations/0005_finance_budget_lines.sql", "db/views/finance.sql"):
            _psql(scratch, "-f", str(REPO / f))
        doc = json.loads(FIXTURE.read_text())
        _load(scratch, doc)
        yield scratch, doc
    finally:
        _psql(admin, "-c", f"DROP DATABASE IF EXISTS {name} WITH (FORCE)", check=False)


def _as_app(url: str, tenant: str | None, query: str):
    """Run one query as the NOBYPASSRLS application role with app.tenant_id set; returns the JSON rows."""
    setup = ["-c", "SET ROLE klarity_app"]
    if tenant is not None:
        setup += ["-c", f"SELECT set_config('app.tenant_id', {_lit(tenant)}, false)"]
    out = _psql(url, *setup, "-c", f"SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM ({query}) t")
    return json.loads(out.strip().splitlines()[-1])


def _close(a: float, b: float) -> bool:
    return abs(float(a) - float(b)) < 0.005


def test_project_summary_and_package_variance_match_the_web_derivations(db) -> None:
    url, doc = db
    for tid, t in doc["tenants"].items():
        rows = {r["project_id"]: r for r in _as_app(url, tid, "SELECT * FROM finance_project_summary")}
        for pid, want in t["expected"]["summary"].items():
            got = rows[pid]
            for col, key in [("budget", "budget"), ("committed", "committed"), ("overrun", "overrun"), ("forecast", "forecast"), ("billed", "billed"),
                             ("collected", "collected"), ("outstanding", "outstanding"), ("overdue", "overdue")]:
                assert _close(got[col], want[key]), f"{pid}.{col}: sql {got[col]} vs web {want[key]}"
            assert abs(float(got["overrun_pct"]) - want["overrunPct"]) < 1e-5, pid
        lines = {(r["project_id"], r["package"]): r for r in _as_app(url, tid, "SELECT * FROM finance_variance_by_package")}
        assert set(lines) == {(l["projectId"], l["package"]) for l in t["expected"]["lines"]}
        for l in t["expected"]["lines"]:
            g = lines[(l["projectId"], l["package"])]
            assert _close(g["budget"], l["budget"]) and _close(g["committed"], l["committed"]) and _close(g["overrun"], l["overrun"]), l


def test_receivables_ageing_and_payables_match(db) -> None:
    url, doc = db
    as_of, days = doc["asOf"], doc["days"]
    for tid, t in doc["tenants"].items():
        exp = t["expected"]
        rec = {r["txn_id"]: r for r in _as_app(url, tid, f"SELECT * FROM finance_open_receivables('{as_of}')")}
        assert set(rec) == {r["txnId"] for r in exp["openReceivables"]}
        for r in exp["openReceivables"]:
            g = rec[r["txnId"]]
            assert (g["days_overdue"], g["age_days"], g["bucket"]) == (r["daysOverdue"], r["ageDays"], r["bucket"]), r
            assert _close(g["amount"], r["amount"])
        ageing = {r["bucket"]: r["amount"] for r in _as_app(url, tid, f"SELECT * FROM finance_receivables_ageing('{as_of}')")}
        assert list(ageing) == [a["bucket"] for a in exp["ageing"]], "all four buckets, in order"
        for a in exp["ageing"]:
            assert _close(ageing[a["bucket"]], a["amount"]), a
        pay = _as_app(url, tid, f"SELECT * FROM finance_payables_due('{as_of}', {days})")
        assert {p["txn_id"] for p in pay} == {p["txnId"] for p in exp["payablesDue30"]}
        assert [p["due_date"] for p in pay] == sorted(p["due_date"] for p in pay), "sorted by due date"


def test_leakage_cash_and_executive_summary_match(db) -> None:
    url, doc = db
    as_of, days = doc["asOf"], doc["days"]
    for tid, t in doc["tenants"].items():
        exp = t["expected"]
        flags = {(f["flag_id"], f["kind"]): f["amount"] for f in _as_app(url, tid, "SELECT * FROM finance_leakage_flags")}
        assert set(flags) == {(f["flagId"], f["kind"]) for f in exp["leakage"]}
        for f in exp["leakage"]:
            assert _close(flags[(f["flagId"], f["kind"])], f["amount"])
        pos = _as_app(url, tid, f"SELECT * FROM finance_cash_position('{as_of}')")
        want = exp["cashPosition"]
        got = pos[0] if pos else {"cash_in": 0, "cash_out": 0, "net": 0}
        assert _close(got["cash_in"], want["cashIn"]) and _close(got["cash_out"], want["cashOut"]) and _close(got["net"], want["net"])
        monthly = _as_app(url, tid, f"SELECT * FROM finance_cash_monthly('{as_of}')")
        assert [m["month"] for m in monthly] == [m["month"] for m in exp["cashMonthly"]]
        for m, w in zip(monthly, exp["cashMonthly"]):
            assert _close(m["cash_in"], w["cashIn"]) and _close(m["cash_out"], w["cashOut"]), w["month"]
        (ex,) = _as_app(url, tid, f"SELECT * FROM finance_executive_summary('{as_of}', {days})")
        for col, key in [("outstanding", "outstanding"), ("overdue", "overdue"), ("payables_due", "payablesDue"), ("forecast_overrun", "forecastOverrun"),
                         ("leakage", "leakage"), ("cash_net", "cashNet")]:
            assert _close(ex[col], exp["executive"][key]), f"executive.{col}: sql {ex[col]} vs web {exp['executive'][key]}"
        assert ex["tenant_id"] == tid


def test_views_never_cross_tenants(db) -> None:
    url, doc = db
    a, b = list(doc["tenants"])
    for tid, other in ((a, b), (b, a)):
        seen = _as_app(url, tid, "SELECT DISTINCT tenant_id FROM finance_txn")
        assert [r["tenant_id"] for r in seen] == [tid]
        for q in ("finance_project_summary", "finance_variance_by_package", "finance_leakage_flags"):
            assert {r["tenant_id"] for r in _as_app(url, tid, f"SELECT tenant_id FROM {q}")} <= {tid}, q
        assert all(r["tenant_id"] == tid for r in _as_app(url, tid, f"SELECT * FROM finance_executive_summary('{doc['asOf']}', 30)"))
        assert _as_app(url, tid, f"SELECT * FROM finance_txn WHERE tenant_id = {_lit(other)}") == []


def test_no_tenant_set_returns_nothing(db) -> None:
    url, doc = db
    assert _as_app(url, None, "SELECT * FROM finance_txn") == []
    assert _as_app(url, "no-such-tenant", "SELECT * FROM finance_project_summary") == []
    assert _as_app(url, "", f"SELECT * FROM finance_executive_summary('{doc['asOf']}', 30)") == []
