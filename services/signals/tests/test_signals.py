# Owner task: EB-61 Attention and risk rules · EB-58 'What changed' signals
from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from attention import evaluate, what_changed
from rules import MetricSnapshot, RuleError, Severity, load_rules, parse_rules
from tenant_context import Placement, TenantContext, TenantStatus, Tier, tenant_scope

PACK = Path(__file__).resolve().parents[3] / "packs" / "aec" / "rules.yaml"


def _ctx(tid="studio8") -> TenantContext:
    p = Placement(cell_id="c1", region="r", pg_cluster="pg", pg_database="d", object_bucket="b",
                  object_prefix=f"tenants/{tid}/", qdrant_cluster="q", qdrant_shard_key=tid, opensearch_cluster="o",
                  opensearch_index="i", opensearch_alias="a", fga_store=f"f-{tid}", temporal_namespace="c1",
                  temporal_queue_prefix="p", litellm_team=tid, kms_key_ref=tid)
    return TenantContext(tid, tid, TenantStatus.ACTIVE, Tier.POOL, p)


def snap(day, tenant="studio8", **vals):
    return MetricSnapshot(tenant, "phoenix", day, {k: Decimal(str(v)) for k, v in vals.items()},
                          ("view:finance_project_summary",), "Project Phoenix")


@pytest.fixture(scope="module")
def rules():
    return load_rules(PACK)


def test_pack_loads_and_core_runs_without_it(rules, tmp_path) -> None:
    assert len(rules) >= 6 and {r.severity for r in rules} == {Severity.LOW, Severity.MEDIUM, Severity.HIGH}
    assert load_rules(tmp_path / "missing.yaml") == []
    with tenant_scope(_ctx()):
        assert evaluate([], snap(date(2026, 10, 1), overrun_pct="0.5")) == []


def test_overrun_fires_once_at_the_highest_severity_with_evidence(rules) -> None:
    with tenant_scope(_ctx()):
        sigs = evaluate(rules, snap(date(2026, 10, 1), overrun_pct="0.12"))
    (s,) = [x for x in sigs if "overrun" in x.rule_id]
    assert s.rule_id == "budget-overrun-critical" and s.severity is Severity.HIGH
    assert "12.0%" in s.message and s.evidence_ids == ("view:finance_project_summary",)
    assert s.action and s.action.requires_approval and s.action.kind == "create_task" and "Phoenix" in s.action.title


def test_missing_metric_never_fires_and_thresholds_are_exact(rules) -> None:
    with tenant_scope(_ctx()):
        assert evaluate(rules, snap(date(2026, 10, 1))) == []
        assert evaluate(rules, snap(date(2026, 10, 1), overrun_pct="0.0499")) == []
        (s,) = evaluate(rules, snap(date(2026, 10, 1), overrun_pct="0.05"))
        assert s.severity is Severity.MEDIUM


def test_what_changed_new_escalated_cleared_and_quiet_when_unchanged(rules) -> None:
    with tenant_scope(_ctx()):
        a = snap(date(2026, 9, 24), overrun_pct="0.06", overdue=0)
        b = snap(date(2026, 10, 1), overrun_pct="0.11", overdue="1200000")
        kinds = {(c.kind, c.key.split(":")[0]) for c in what_changed(rules, a, b)}
        assert ("escalated", "budget-overrun-critical") in kinds and ("new", "receivables-overdue") in kinds
        c = snap(date(2026, 10, 8), overrun_pct="0.11", overdue=0)
        assert ("cleared", "receivables-overdue:phoenix") in {(x.kind, x.key) for x in what_changed(rules, b, c)}
        quiet = [x for x in what_changed(rules, b, snap(date(2026, 10, 8), overrun_pct="0.11", overdue="1200000"))
                 if x.kind != "metric"]
        assert quiet == []  # unchanged signals are not repeated


def test_no_action_is_ever_auto_approved(rules) -> None:
    with tenant_scope(_ctx()):
        sigs = evaluate(rules, snap(date(2026, 10, 1), overrun_pct="0.2", overdue="5"))
    actions = [s.action for s in sigs if s.action]
    assert actions and all(a.requires_approval for a in actions)


def test_snapshot_from_another_tenant_is_refused(rules) -> None:
    with tenant_scope(_ctx("other")):
        with pytest.raises(PermissionError):
            evaluate(rules, snap(date(2026, 10, 1), overrun_pct="0.2"))


def test_what_changed_argument_validation(rules) -> None:
    with tenant_scope(_ctx()):
        with pytest.raises(ValueError):
            what_changed(rules, snap(date(2026, 10, 8)), snap(date(2026, 10, 1)))


def test_rule_file_validation() -> None:
    bad = lambda **kw: {"version": 1, "rules": [{"id": "r", "metric": "m", "operator": ">", "threshold": "1",  # noqa: E731
                                                  "severity": "low", "title": "t", "message": "m", **kw}]}
    parse_rules(bad())
    for broken in (bad(operator="~"), bad(severity="urgent"), bad(threshold="lots"), bad(action={"kind": "wire_money", "title": "x"})):
        with pytest.raises(RuleError):
            parse_rules(broken)
    with pytest.raises(RuleError):
        parse_rules({"version": 2, "rules": []})
    with pytest.raises(RuleError):
        parse_rules({"version": 1, "rules": bad()["rules"] * 2})  # duplicate id
