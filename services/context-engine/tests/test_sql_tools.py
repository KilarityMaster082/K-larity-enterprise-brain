# Owner task: EB-56 Finance SQL routing
"""Unit tests for FinanceSqlRouter, reviewed SQL query construction, and tenant isolation."""

from __future__ import annotations

import pytest

from sql_tools import (
    FinanceMetricType,
    FinanceSqlRouter,
    REVIEWED_FINANCE_VIEWS,
)


def test_reviewed_views_list_is_populated() -> None:
    assert "finance_variance_by_package" in REVIEWED_FINANCE_VIEWS
    assert "finance_project_summary" in REVIEWED_FINANCE_VIEWS
    assert "finance_leakage_flags" in REVIEWED_FINANCE_VIEWS
    assert "finance_cash_position" in REVIEWED_FINANCE_VIEWS


def test_detect_finance_intents() -> None:
    router = FinanceSqlRouter()
    intents = router.detect_finance_intent("Why is Project Phoenix over budget?")
    assert FinanceMetricType.BUDGET_OVERRUN in intents

    pkg_intents = router.detect_finance_intent("What is the variance on the facade and MEP packages?")
    assert FinanceMetricType.PACKAGE_VARIANCE in pkg_intents

    cash_intents = router.detect_finance_intent("What is our current cash position and 30-day burn rate?")
    assert FinanceMetricType.CASH_POSITION in cash_intents


def test_extract_project_hint() -> None:
    router = FinanceSqlRouter()
    assert router.extract_project_hint("Why is project Phoenix over budget?") == "phoenix"
    assert router.extract_project_hint("Status of Tower-A facade") == "prj-tower-a"
    assert router.extract_project_hint("Overall company cash", fallback_project_id="prj-demo") == "prj-demo"


def test_build_queries_requires_tenant_id() -> None:
    router = FinanceSqlRouter()
    with pytest.raises(ValueError, match="tenant_id is required"):
        router.build_queries([FinanceMetricType.BUDGET_OVERRUN], "prj-phoenix", tenant_id="")


def test_build_queries_creates_reviewed_parameterized_sql() -> None:
    router = FinanceSqlRouter()
    queries = router.build_queries(
        [FinanceMetricType.BUDGET_OVERRUN, FinanceMetricType.PACKAGE_VARIANCE],
        "prj-phoenix",
        tenant_id="studio8",
    )
    assert len(queries) == 2
    for sql, params, desc in queries:
        assert params["tenant_id"] == "studio8"
        assert params["project_id"] == "prj-phoenix"
        assert any(view in sql for view in REVIEWED_FINANCE_VIEWS)


def test_execute_and_format_with_mock_executor() -> None:
    executed_queries: list[str] = []

    def mock_db(sql: str, params: dict) -> list[dict]:
        executed_queries.append(sql)
        if "finance_project_summary" in sql:
            return [{
                "project_id": params.get("project_id", "prj-phoenix"),
                "overrun": 2500000.0,
                "committed": 12500000.0,
            }]
        return []

    router = FinanceSqlRouter(db_executor=mock_db)
    results = router.execute_and_format(
        "Why is Project Phoenix over budget?",
        tenant_id="studio8",
        project_id="prj-phoenix",
    )

    assert len(executed_queries) > 0
    assert len(results) >= 1
    first = results[0]
    assert first["currency"] == "INR"
    assert first["amount"] in (2500000.0, 12500000.0)
    assert "prj-phoenix" in first["query"] or ":project_id" in first["query"]
