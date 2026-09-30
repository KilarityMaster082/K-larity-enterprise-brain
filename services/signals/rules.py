# Owner task: EB-61 Attention and risk rules
"""Declarative attention rules and the metric snapshots they run over.

The engine is domain-agnostic: a rule names a metric, a comparison, a threshold and a severity. What the metrics
*mean* (budget overrun, overdue billing …) lives in a pack file such as packs/aec/rules.yaml, so the core runs
with no pack loaded (CLAUDE.md rule 6). Thresholds are ``Decimal`` parsed from strings and metric values are
``Decimal`` supplied from SQL — the engine never derives a number from text (rule 3).
"""

from __future__ import annotations

import operator as op
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from enum import Enum
from pathlib import Path
from typing import Any, Mapping

import yaml

RULES_VERSION = 1
_OPS = {">": op.gt, ">=": op.ge, "<": op.lt, "<=": op.le, "==": op.eq, "!=": op.ne}


class Severity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"

    @property
    def rank(self) -> int:
        return ("low", "medium", "high").index(self.value)


class RuleError(ValueError):
    pass


@dataclass(frozen=True)
class ActionTemplate:
    kind: str           # draft_message | create_task | update_record — always submitted for approval, never run
    title: str


@dataclass(frozen=True)
class Rule:
    id: str
    metric: str
    operator: str
    threshold: Decimal
    severity: Severity
    title: str
    message: str
    action: ActionTemplate | None = None

    def matches(self, value: Decimal) -> bool:
        return _OPS[self.operator](value, self.threshold)


@dataclass(frozen=True)
class MetricSnapshot:
    tenant_id: str
    project_id: str
    as_of: date
    values: Mapping[str, Decimal]
    evidence_ids: tuple[str, ...]      # the SQL views / query ids the values came from
    project_name: str | None = None


def _decimal(raw: Any, where: str) -> Decimal:
    try:
        return Decimal(str(raw))
    except InvalidOperation as exc:
        raise RuleError(f"{where}: {raw!r} is not a number") from exc


def parse_rules(data: Mapping[str, Any]) -> list[Rule]:
    if data.get("version") != RULES_VERSION:
        raise RuleError(f"unsupported rules version: {data.get('version')!r}")
    rules: list[Rule] = []
    seen: set[str] = set()
    for raw in data.get("rules") or []:
        rid = str(raw.get("id", "")).strip()
        if not rid or rid in seen:
            raise RuleError(f"rule id missing or duplicated: {rid!r}")
        seen.add(rid)
        if raw.get("operator") not in _OPS:
            raise RuleError(f"{rid}: unknown operator {raw.get('operator')!r}")
        try:
            severity = Severity(raw.get("severity"))
        except ValueError as exc:
            raise RuleError(f"{rid}: unknown severity {raw.get('severity')!r}") from exc
        action = None
        if raw.get("action"):
            if raw["action"].get("kind") not in ("draft_message", "create_task", "update_record"):
                raise RuleError(f"{rid}: unknown action kind")
            action = ActionTemplate(raw["action"]["kind"], raw["action"]["title"])
        rules.append(Rule(rid, str(raw["metric"]), raw["operator"], _decimal(raw.get("threshold"), f"{rid}.threshold"),
                          severity, raw["title"], raw["message"], action))
    return rules


def load_rules(path: str | Path) -> list[Rule]:
    p = Path(path)
    if not p.exists():
        return []  # pack not installed: core still runs
    return parse_rules(yaml.safe_load(p.read_text(encoding="utf-8")) or {})
