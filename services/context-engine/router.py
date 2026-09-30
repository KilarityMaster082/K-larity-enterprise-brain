# Owner task: EB-49 Query router (fast path vs investigation)
"""Query routing between cheap fast path (lookups) and deep investigation path (causal/multi-hop).

Enforces:
- Routing rules based on query intent and structural triggers.
- Model alias resolution per path ('fast' tier vs 'reason' tier).
- Latency SLA tracking: lookup p95 < 3.0s, investigation p95 < 20.0s.
- Detailed token cost tracking and logging per query.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import logging
import math
import re
import time
from typing import Any, Callable, Sequence

from compress import QueryIntent
try:
    from router import LlmRouter, ModelAlias, ModelCallResult
except ImportError:
    try:
        from services.llm_gateway.router import LlmRouter, ModelAlias, ModelCallResult  # type: ignore
    except ImportError:
        class ModelAlias:  # type: ignore
            FAST = "fast"
            REASON = "reason"
        class LlmRouter:  # type: ignore
            def complete(self, *args, **kwargs):
                raise NotImplementedError()
        class ModelCallResult:  # type: ignore
            pass

logger = logging.getLogger(__name__)

LOOKUP_P95_SLA_SEC = 3.0
INVESTIGATION_P95_SLA_SEC = 20.0


class RoutePath(str, Enum):
    FAST_PATH = "fast_path"
    INVESTIGATION_PATH = "investigation_path"


@dataclass
class RouteDecision:
    """Routing outcome determining execution path, model tier, and SLA."""

    path: RoutePath
    model_alias: ModelAlias
    max_tokens: int
    sla_seconds: float
    reason: str
    requires_graph_traversal: bool


@dataclass
class RouteExecutionMetrics:
    """Execution telemetry and cost logging for a routed query."""

    question: str
    path: RoutePath
    model_used: str
    duration_sec: float
    sla_met: bool
    sla_target_sec: float
    cost_usd: float
    prompt_tokens: int
    completion_tokens: int
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class QueryRouter:
    """Routes questions to fast lookup path or multi-hop deep investigation path."""

    # Keywords that unambiguously require deep root-cause or multi-hop synthesis
    INVESTIGATION_TRIGGERS = [
        r"\bwhy\b",
        r"\broot\s+cause\b",
        r"\bhow\s+did\b",
        r"\bexplain\s+(?:the\s+)?delay\b",
        r"\bconflict\b",
        r"\bdispute\b",
        r"\bdiscrepanc(?:y|ies)\b",
        r"\bcompare\b",
        r"\btimeline\s+of\b",
        r"\bvariation\s+order\b",
        r"\bwho\s+approved\b",
        r"\bimpact\s+of\b",
    ]

    # Lookups and factoids
    LOOKUP_TRIGGERS = [
        r"\bwhat\s+is\s+the\s+grade\b",
        r"\bcontact\b",
        r"\bphone\b",
        r"\bemail\b",
        r"\bwhere\s+is\b",
        r"\bwhen\s+was\b",
        r"\bdate\s+of\b",
        r"\brate\s+of\b",
        r"\bunit\s+price\b",
        r"\bspecification\b",
    ]

    def __init__(
        self,
        llm_router: LlmRouter | None = None,
        default_budget_usd: float = 500.0,
    ) -> None:
        self.llm_router = llm_router or LlmRouter(default_budget_usd=default_budget_usd)
        self._lookup_durations: list[float] = []
        self._investigation_durations: list[float] = []
        self._execution_history: list[RouteExecutionMetrics] = []

    @property
    def lookup_p95_sec(self) -> float:
        return self._compute_p95(self._lookup_durations)

    @property
    def investigation_p95_sec(self) -> float:
        return self._compute_p95(self._investigation_durations)

    @property
    def total_spend_usd(self) -> float:
        return sum(m.cost_usd for m in self._execution_history)

    @staticmethod
    def _compute_p95(durations: list[float]) -> float:
        if not durations:
            return 0.0
        sorted_d = sorted(durations)
        idx = int(math.ceil(0.95 * len(sorted_d))) - 1
        return sorted_d[max(0, min(idx, len(sorted_d) - 1))]

    def decide_route(
        self,
        question: str,
        explicit_intent: QueryIntent | str | None = None,
    ) -> RouteDecision:
        """Determines whether query uses fast lookup path or investigation path."""
        q_lower = question.lower().strip()

        # 1. Explicit Intent override if provided
        if explicit_intent:
            intent_val = explicit_intent.value if isinstance(explicit_intent, QueryIntent) else explicit_intent
            if intent_val in (QueryIntent.FACTOID.value, QueryIntent.LOOKUP.value):
                return RouteDecision(
                    path=RoutePath.FAST_PATH,
                    model_alias=ModelAlias.FAST,
                    max_tokens=2000,
                    sla_seconds=LOOKUP_P95_SLA_SEC,
                    reason=f"Explicit intent '{intent_val}' mapped to fast path",
                    requires_graph_traversal=False,
                )
            if intent_val in (QueryIntent.ANALYSIS.value, QueryIntent.DEEP_REASONING.value, QueryIntent.COMPARISON.value):
                return RouteDecision(
                    path=RoutePath.INVESTIGATION_PATH,
                    model_alias=ModelAlias.REASON,
                    max_tokens=8000,
                    sla_seconds=INVESTIGATION_P95_SLA_SEC,
                    reason=f"Explicit intent '{intent_val}' mapped to investigation path",
                    requires_graph_traversal=True,
                )

        # 2. Check for investigation patterns
        for pattern in self.INVESTIGATION_TRIGGERS:
            if re.search(pattern, q_lower):
                return RouteDecision(
                    path=RoutePath.INVESTIGATION_PATH,
                    model_alias=ModelAlias.REASON,
                    max_tokens=8000,
                    sla_seconds=INVESTIGATION_P95_SLA_SEC,
                    reason=f"Matched investigation trigger pattern '{pattern}'",
                    requires_graph_traversal=True,
                )

        # 3. Check for lookup patterns
        for pattern in self.LOOKUP_TRIGGERS:
            if re.search(pattern, q_lower):
                return RouteDecision(
                    path=RoutePath.FAST_PATH,
                    model_alias=ModelAlias.FAST,
                    max_tokens=2000,
                    sla_seconds=LOOKUP_P95_SLA_SEC,
                    reason=f"Matched lookup trigger pattern '{pattern}'",
                    requires_graph_traversal=False,
                )

        # 4. Default heuristic: short simple queries (< 10 words) fast path; longer queries investigation path
        words = q_lower.split()
        if len(words) <= 12:
            return RouteDecision(
                path=RoutePath.FAST_PATH,
                model_alias=ModelAlias.FAST,
                max_tokens=2000,
                sla_seconds=LOOKUP_P95_SLA_SEC,
                reason="Default short query heuristic -> fast path",
                requires_graph_traversal=False,
            )
        else:
            return RouteDecision(
                path=RoutePath.INVESTIGATION_PATH,
                model_alias=ModelAlias.REASON,
                max_tokens=6000,
                sla_seconds=INVESTIGATION_P95_SLA_SEC,
                reason="Multi-clause query heuristic -> investigation path",
                requires_graph_traversal=True,
            )

    async def execute_routed_query(
        self,
        question: str,
        executor_fn: Callable[[RouteDecision], Any],
        explicit_intent: QueryIntent | str | None = None,
        *,
        tenant_id: str | None = None,
    ) -> tuple[Any, RouteExecutionMetrics]:
        """Routes query, executes appropriate path, records latency SLA and logs token cost."""
        decision = self.decide_route(question, explicit_intent)
        start_time = time.perf_counter()

        # Run designated pipeline execution function
        result = await executor_fn(decision)

        duration_sec = time.perf_counter() - start_time
        sla_met = duration_sec <= decision.sla_seconds

        # Record latency history
        if decision.path == RoutePath.FAST_PATH:
            self._lookup_durations.append(duration_sec)
        else:
            self._investigation_durations.append(duration_sec)

        # Extract usage and cost if result has usage metadata
        cost_usd = 0.0
        prompt_tokens = 0
        comp_tokens = 0
        model_name = decision.model_alias.value

        if hasattr(result, "cost_usd"):
            cost_usd = getattr(result, "cost_usd")
        elif hasattr(result, "usage") and isinstance(result.usage, dict):
            prompt_tokens = result.usage.get("prompt_tokens", 0)
            comp_tokens = result.usage.get("completion_tokens", 0)
            # Estimate cost based on tier
            if decision.path == RoutePath.FAST_PATH:
                cost_usd = (prompt_tokens * 0.075 + comp_tokens * 0.30) / 1_000_000
            else:
                cost_usd = (prompt_tokens * 3.0 + comp_tokens * 15.0) / 1_000_000

        metrics = RouteExecutionMetrics(
            question=question,
            path=decision.path,
            model_used=model_name,
            duration_sec=duration_sec,
            sla_met=sla_met,
            sla_target_sec=decision.sla_seconds,
            cost_usd=cost_usd,
            prompt_tokens=prompt_tokens,
            completion_tokens=comp_tokens,
        )
        self._execution_history.append(metrics)

        logger.info(
            f"Query routed to {decision.path.value} via {decision.model_alias.value} "
            f"in {duration_sec:.3f}s (SLA <= {decision.sla_seconds}s: {sla_met}), Cost: ${cost_usd:.6f}"
        )

        return result, metrics
