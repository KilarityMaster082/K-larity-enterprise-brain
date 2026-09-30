# Owner task: EB-44 Graph traversal · EB-37 events feed facts
"""Temporal facts: one current value per (subject, predicate), history preserved.

Asserting a new value closes the previous one at the new fact's ``valid_from`` instead of overwriting it, so
"what was the contract value on 1 June?" and "what is it now?" both have answers, each with its evidence.
Numbers are kept as decimal strings copied from a source or SQL result, never floats (rule 3).
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, replace
from datetime import datetime, timezone

from tenant_context import current_tenant

FAR_FUTURE = datetime(9999, 12, 31, tzinfo=timezone.utc)


class FactError(Exception):
    pass


@dataclass(frozen=True)
class Fact:
    subject: str
    predicate: str
    value: str
    evidence_ids: tuple[str, ...]
    valid_from: datetime
    valid_to: datetime = FAR_FUTURE

    def valid_at(self, at: datetime) -> bool:
        return self.valid_from <= at < self.valid_to


class FactStore:
    def __init__(self) -> None:
        self._facts: dict[tuple[str, str, str], list[Fact]] = {}
        self._lock = threading.Lock()

    def assert_fact(self, subject: str, predicate: str, value: str, *, evidence_ids: tuple[str, ...],
                    valid_from: datetime) -> Fact:
        if not evidence_ids:
            raise FactError("a fact must cite evidence")
        key = (current_tenant().tenant_id, subject, predicate)
        new = Fact(subject, predicate, value, tuple(evidence_ids), valid_from)
        with self._lock:
            history = self._facts.setdefault(key, [])
            current = next((f for f in reversed(history) if f.valid_to == FAR_FUTURE), None)
            if current is not None:
                if current.value == value:
                    return current  # same value re-asserted: nothing changes
                if valid_from <= current.valid_from:
                    raise FactError("a new value must start after the current one (backdated corrections are separate)")
                history[history.index(current)] = replace(current, valid_to=valid_from)
            history.append(new)
        return new

    def value_at(self, subject: str, predicate: str, at: datetime) -> Fact | None:
        history = self._facts.get((current_tenant().tenant_id, subject, predicate), [])
        return next((f for f in history if f.valid_at(at)), None)

    def history(self, subject: str, predicate: str) -> list[Fact]:
        return list(self._facts.get((current_tenant().tenant_id, subject, predicate), []))
