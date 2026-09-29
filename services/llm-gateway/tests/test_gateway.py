# Owner task: EB-26 LiteLLM gateway
"""Unit tests for LiteLLM gateway, model aliases, fallbacks, budgets, and Langfuse tracing."""

from __future__ import annotations

from pathlib import Path
from typing import Any
import pytest
import yaml

try:
    from services.llm_gateway import (
        BudgetExceededError,
        LlmRouter,
        ModelAlias,
        ModelUnavailableError,
    )
except ImportError:
    from router import (
        BudgetExceededError,
        LlmRouter,
        ModelAlias,
        ModelUnavailableError,
    )
from tenant_context import (
    Placement,
    TenantContext,
    TenantStatus,
    Tier,
    tenant_scope,
)


def _make_ctx(tenant_id: str) -> TenantContext:
    p = Placement(
        cell_id="c1",
        region="ap-south-2",
        pg_cluster="pg",
        pg_database="brain",
        object_bucket="b",
        object_prefix=f"tenants/{tenant_id}/",
        qdrant_cluster="q",
        qdrant_shard_key=tenant_id,
        opensearch_cluster="os",
        opensearch_index=f"docs-{tenant_id}",
        opensearch_alias=f"tenant-{tenant_id}",
        fga_store=f"fga-{tenant_id}",
        temporal_namespace="c1",
        temporal_queue_prefix="pool",
        litellm_team=f"tenant-{tenant_id}",
        kms_key_ref=f"alias/klarity-tenant-{tenant_id}",
    )
    return TenantContext(
        tenant_id=tenant_id,
        slug=tenant_id,
        status=TenantStatus.ACTIVE,
        tier=Tier.POOL,
        placement=p,
    )


@pytest.fixture
def tenant_studio8() -> TenantContext:
    return _make_ctx("studio8")


def test_config_yaml_structure() -> None:
    """Subtask 1, 3, 4, 5: Verify config.yaml definitions and MIT core."""
    config_path = Path(__file__).resolve().parents[1] / "config.yaml"
    assert config_path.exists(), "config.yaml must exist"
    data = yaml.safe_load(config_path.read_text(encoding="utf-8"))

    # 1. Aliases defined
    models = {m["model_name"] for m in data.get("model_list", [])}
    assert {"fast", "fast-fallback", "reason", "reason-fallback", "embed", "rerank"}.issubset(models)

    # 2. Fallbacks configured
    fallbacks = data.get("router_settings", {}).get("fallbacks", [])
    assert any("fast" in fb for fb in fallbacks)
    assert any("reason" in fb for fb in fallbacks)

    # 3. Langfuse callback configured
    callbacks = data.get("litellm_settings", {}).get("success_callback", [])
    assert "langfuse" in callbacks

    # 4. Budgets configured
    assert data.get("general_settings", {}).get("default_monthly_budget") == 500.0


def test_calling_model_aliases(tenant_studio8: TenantContext) -> None:
    """Subtask 1: Services call aliases not vendor names."""
    router = LlmRouter()

    with tenant_scope(tenant_studio8):
        res = router.complete(
            alias=ModelAlias.FAST,
            messages=[{"role": "user", "content": "Extract keywords"}],
            estimated_cost=0.005,
        )

        assert res.alias == "fast"
        assert res.model_used == "gemini/gemini-2.5-flash"
        assert res.cost_usd == 0.005
        assert res.trace_id is not None


def test_over_budget_tenant_is_blocked(tenant_studio8: TenantContext) -> None:
    """Subtask 2 & 6: Acceptance criterion: a tenant over budget is blocked."""
    router = LlmRouter()
    # Set tight budget
    router.set_budget("studio8", monthly_budget_usd=10.0)

    with tenant_scope(tenant_studio8):
        # 1. Under budget succeeds
        router.complete(ModelAlias.FAST, messages=[], estimated_cost=8.0)
        assert router.get_budget("studio8").current_spend_usd == 8.0

        # 2. Next call pushes over budget
        router.complete(ModelAlias.FAST, messages=[], estimated_cost=3.0)
        assert router.get_budget("studio8").current_spend_usd == 11.0

        # 3. Subsequent call is blocked
        with pytest.raises(BudgetExceededError) as exc_info:
            router.complete(ModelAlias.FAST, messages=[], estimated_cost=0.01)

        assert "exceeded monthly LLM budget" in str(exc_info.value)


def test_langfuse_callback_for_every_call(tenant_studio8: TenantContext) -> None:
    """Subtask 3: Acceptance criterion: every call appears in Langfuse."""
    router = LlmRouter()

    with tenant_scope(tenant_studio8):
        assert len(router.langfuse_callbacks) == 0

        router.complete(ModelAlias.FAST, messages=[], estimated_cost=0.02)
        assert len(router.langfuse_callbacks) == 1
        cb1 = router.langfuse_callbacks[0]
        assert cb1["tenant_id"] == "studio8"
        assert cb1["alias"] == "fast"
        assert cb1["status"] == "success"

        router.complete(ModelAlias.REASON, messages=[], estimated_cost=0.05)
        assert len(router.langfuse_callbacks) == 2
        cb2 = router.langfuse_callbacks[1]
        assert cb2["alias"] == "reason"


def test_fallback_order_per_alias(tenant_studio8: TenantContext) -> None:
    """Subtask 4: Primary model failure automatically triggers configured fallback."""
    router = LlmRouter()

    def mock_invoker_with_fail(model: str, messages: list[dict[str, str]]) -> str:
        if model == "gemini/gemini-2.5-flash":
            raise RuntimeError("Gemini API rate limited (429)")
        return f"Fallback response from {model}"

    with tenant_scope(tenant_studio8):
        res = router.complete(
            alias=ModelAlias.FAST,
            messages=[],
            mock_invoker=mock_invoker_with_fail,
            estimated_cost=0.01,
        )

        # Successfully resolved fallback model
        assert res.model_used == "openai/gpt-4o-mini"
        assert "Fallback response" in res.content
