# Owner task: EB-49 Query router (fast path vs investigation)
"""Unit and benchmark tests for query routing, model alias assignment, latency SLAs, and cost-per-query metrics."""

from __future__ import annotations

import asyncio
import importlib.util
from pathlib import Path
import pytest

from compress import QueryIntent
from router import ModelAlias  # From services/llm-gateway/router.py

import sys

# Explicitly load services/context-engine/router.py to avoid name collision with llm-gateway router
_router_path = Path(__file__).resolve().parents[1] / "router.py"
_spec = importlib.util.spec_from_file_location("context_engine_router", _router_path)
ce_router = importlib.util.module_from_spec(_spec)
sys.modules["context_engine_router"] = ce_router
_spec.loader.exec_module(ce_router)  # type: ignore

INVESTIGATION_P95_SLA_SEC = ce_router.INVESTIGATION_P95_SLA_SEC
LOOKUP_P95_SLA_SEC = ce_router.LOOKUP_P95_SLA_SEC
QueryRouter = ce_router.QueryRouter
RouteDecision = ce_router.RouteDecision
RoutePath = ce_router.RoutePath


def test_routing_rules_from_intent() -> None:
    """Subtask 1 & 2: Tests intent and keyword-based routing rules and model alias assignment."""
    router = QueryRouter()

    # Fast path lookups
    d1 = router.decide_route("What is the grade of concrete for Tower B foundation piles?")
    assert d1.path == RoutePath.FAST_PATH
    assert d1.model_alias == ModelAlias.FAST
    assert d1.requires_graph_traversal is False
    assert d1.sla_seconds == LOOKUP_P95_SLA_SEC

    d2 = router.decide_route("When was invoice #104 submitted?")
    assert d2.path == RoutePath.FAST_PATH
    assert d2.model_alias == ModelAlias.FAST

    # Investigation path (why, root cause, timeline, dispute)
    d3 = router.decide_route("Why did the foundation piling take 3 weeks longer than scheduled?")
    assert d3.path == RoutePath.INVESTIGATION_PATH
    assert d3.model_alias == ModelAlias.REASON
    assert d3.requires_graph_traversal is True
    assert d3.sla_seconds == INVESTIGATION_P95_SLA_SEC

    d4 = router.decide_route("Explain root cause of variance between certified bills and structural BOQ")
    assert d4.path == RoutePath.INVESTIGATION_PATH
    assert d4.model_alias == ModelAlias.REASON

    # Explicit QueryIntent overrides
    d5 = router.decide_route("Check status", explicit_intent=QueryIntent.FACTOID)
    assert d5.path == RoutePath.FAST_PATH

    d6 = router.decide_route("Check status", explicit_intent=QueryIntent.DEEP_REASONING)
    assert d6.path == RoutePath.INVESTIGATION_PATH


def test_cost_and_latency_tracking() -> None:
    """Subtask 3: Tests cost-per-query logging and SLA tracking."""
    router = QueryRouter()

    class MockQueryResult:
        def __init__(self, answer: str, prompt_tokens: int, comp_tokens: int) -> None:
            self.answer = answer
            self.usage = {"prompt_tokens": prompt_tokens, "completion_tokens": comp_tokens}

    async def mock_executor(decision: RouteDecision) -> MockQueryResult:
        # Simulate quick latency
        await asyncio.sleep(0.005)
        if decision.path == RoutePath.FAST_PATH:
            return MockQueryResult("M35 grade", prompt_tokens=200, comp_tokens=50)
        else:
            return MockQueryResult("Root cause is delayed RMC transit", prompt_tokens=1500, comp_tokens=400)

    # Execute lookup
    res1, metrics1 = asyncio.run(
        router.execute_routed_query(
            "What is the grade of concrete for Tower B?",
            executor_fn=mock_executor,
        )
    )
    assert metrics1.path == RoutePath.FAST_PATH
    assert metrics1.sla_met is True
    assert metrics1.cost_usd > 0.0
    assert metrics1.prompt_tokens == 200

    # Execute deep investigation
    res2, metrics2 = asyncio.run(
        router.execute_routed_query(
            "Why was the piling concrete pour delayed?",
            executor_fn=mock_executor,
        )
    )
    assert metrics2.path == RoutePath.INVESTIGATION_PATH
    assert metrics2.sla_met is True
    assert metrics2.cost_usd > metrics1.cost_usd
    assert metrics2.prompt_tokens == 1500

    # Verify total spend accumulation
    assert router.total_spend_usd == metrics1.cost_usd + metrics2.cost_usd


def test_p95_sla_benchmarks() -> None:
    """Subtask 4 & Acceptance criteria: Lookup p95 < 3s, Investigation p95 < 20s."""
    router = QueryRouter()

    async def fast_executor(decision: RouteDecision) -> dict[str, str]:
        if decision.path == RoutePath.FAST_PATH:
            await asyncio.sleep(0.002)
        else:
            await asyncio.sleep(0.010)
        return {"status": "ok"}

    # Run 20 lookup queries
    for i in range(20):
        asyncio.run(
            router.execute_routed_query(
                f"What is the rate for item #{i}?",
                executor_fn=fast_executor,
            )
        )

    # Run 10 investigation queries
    for i in range(10):
        asyncio.run(
            router.execute_routed_query(
                f"Why did contractor #{i} file a dispute over variation orders?",
                executor_fn=fast_executor,
            )
        )

    # Acceptance criteria verification:
    assert router.lookup_p95_sec < LOOKUP_P95_SLA_SEC
    assert router.lookup_p95_sec < 1.0  # Well under 3s
    assert router.investigation_p95_sec < INVESTIGATION_P95_SLA_SEC
    assert router.investigation_p95_sec < 2.0  # Well under 20s
