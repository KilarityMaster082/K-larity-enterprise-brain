# Owner task: EB-61 Attention and risk rules · EB-58 'What changed' signals
"""Evaluate rules over metric snapshots and report what changed between two snapshots.

* ``evaluate`` — the signals that are active in one snapshot.
* ``what_changed`` — between a previous and a current snapshot: signals that appeared, cleared or got worse,
  plus metric movements. Signals that are unchanged are *not* repeated (no alert fatigue).
* Every signal cites the evidence (SQL views) its numbers came from (rule 4); a missing metric never fires a rule.
* A rule's ``action`` becomes a :class:`ProposedAction` — arguments for an approval request (EB-66), never an
  executed side effect (rule 10).
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Sequence

from rules import MetricSnapshot, Rule, Severity
from tenant_context import current_tenant


@dataclass(frozen=True)
class ProposedAction:
    kind: str
    title: str
    project_id: str
    reason: str
    evidence_ids: tuple[str, ...]
    requires_approval: bool = True   # always; there is no auto-execute path


@dataclass(frozen=True)
class Signal:
    key: str                     # rule id + project: identity across snapshots
    rule_id: str
    project_id: str
    severity: Severity
    title: str
    message: str
    value: Decimal
    evidence_ids: tuple[str, ...]
    action: ProposedAction | None = None


@dataclass(frozen=True)
class Change:
    kind: str                    # "new" | "escalated" | "cleared" | "metric"
    key: str
    detail: str
    signal: Signal | None = None


def _pct(v: Decimal) -> str:
    return f"{(v * 100).quantize(Decimal('0.1'))}%"


def _fmt(v: Decimal) -> str:
    return f"{v:,.0f}" if v == v.to_integral() else f"{v:,.2f}"


def evaluate(rules: Sequence[Rule], snapshot: MetricSnapshot) -> list[Signal]:
    if snapshot.tenant_id != current_tenant().tenant_id:
        raise PermissionError("snapshot belongs to another tenant")
    out: list[Signal] = []
    project = snapshot.project_name or snapshot.project_id
    for rule in rules:
        value = snapshot.values.get(rule.metric)
        if value is None or not rule.matches(value):
            continue
        ctx = {"project": project, "value": _fmt(value), "value_pct": _pct(value)}
        action = None
        if rule.action:
            action = ProposedAction(rule.action.kind, rule.action.title.format(**ctx), snapshot.project_id,
                                    rule.message.format(**ctx), snapshot.evidence_ids)
        out.append(Signal(f"{rule.id}:{snapshot.project_id}", rule.id, snapshot.project_id, rule.severity, rule.title,
                          rule.message.format(**ctx), value, snapshot.evidence_ids, action))
    return _dedupe_same_metric(rules, out)


def _dedupe_same_metric(rules: Sequence[Rule], signals: list[Signal]) -> list[Signal]:
    """If a watch and a critical rule fire on the same metric, keep only the most severe (one message, not two)."""
    metric_of = {r.id: r.metric for r in rules}
    best: dict[str, Signal] = {}
    for s in signals:
        m = metric_of[s.rule_id]
        if m not in best or s.severity.rank > best[m].severity.rank:
            best[m] = s
    kept = {id(s) for s in best.values()}
    return [s for s in signals if id(s) in kept]


def what_changed(rules: Sequence[Rule], previous: MetricSnapshot, current: MetricSnapshot) -> list[Change]:
    if previous.project_id != current.project_id or previous.tenant_id != current.tenant_id:
        raise ValueError("snapshots must be for the same tenant and project")
    if previous.as_of >= current.as_of:
        raise ValueError("previous snapshot must be older than the current one")
    before = {s.key: s for s in evaluate(rules, previous)}
    after = {s.key: s for s in evaluate(rules, current)}
    changes: list[Change] = []
    for key, sig in after.items():
        old = before.get(key)
        if old is None:
            # the other rule on the same metric may have been the active one before: that's an escalation
            sibling = next((b for b in before.values() if _same_metric(rules, b.rule_id, sig.rule_id)), None)
            if sibling is None:
                changes.append(Change("new", key, sig.message, sig))
            elif sig.severity.rank > sibling.severity.rank:
                changes.append(Change("escalated", key, f"{sibling.severity.value} → {sig.severity.value}: {sig.message}", sig))
        elif sig.severity.rank > old.severity.rank:
            changes.append(Change("escalated", key, f"{old.severity.value} → {sig.severity.value}: {sig.message}", sig))
    for key, sig in before.items():
        if key not in after and not any(_same_metric(rules, sig.rule_id, a.rule_id) for a in after.values()):
            changes.append(Change("cleared", key, f"No longer active: {sig.title}", None))
    for metric in sorted(set(previous.values) & set(current.values)):
        a, b = previous.values[metric], current.values[metric]
        if a != b:
            changes.append(Change("metric", f"{metric}:{current.project_id}", f"{metric} {_fmt(a)} → {_fmt(b)}"))
    return changes


def _same_metric(rules: Sequence[Rule], a: str, b: str) -> bool:
    m = {r.id: r.metric for r in rules}
    return m.get(a) == m.get(b)
