# Owner task: EB-25 Cross-tenant isolation suite
from __future__ import annotations

import pytest

import cross_tenant as ct


def test_all_isolation_checks_pass(tmp_path) -> None:
    results = ct.run_suite(tmp_path)
    failed = [f"{r.name}: {r.detail}" for r in results if not r.passed]
    assert not failed, failed
    assert len(results) == 11  # 5 checks x 2 tenants + no-context


def test_suite_detects_a_broken_tenant_filter(tmp_path, monkeypatch) -> None:
    """The suite must fail closed: disabling the search tenant filter has to produce a failure."""
    from storage import search_store

    monkeypatch.setattr(search_store.SearchStore, "_tenant_filter", lambda self: {"match_all": {}})
    results = ct.run_suite(tmp_path)
    assert any(not r.passed and "lexical" in r.name for r in results)
