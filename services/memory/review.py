# Owner task: EB-53 Decision Memory
"""Review queue over Decision Memory drafts: what a person should look at first."""

from __future__ import annotations

from decision_memory import Decision, DecisionMemory, DecisionStatus


def review_queue(memory: DecisionMemory, project_id: str | None = None) -> list[Decision]:
    """Proposed drafts, lowest confidence first (the ones most likely to be wrong), then oldest id."""
    drafts = memory.list(project_id=project_id, status=DecisionStatus.PROPOSED)
    return sorted(drafts, key=lambda d: (d.confidence if d.confidence is not None else 0.0, d.decision_id))


def summary(memory: DecisionMemory, project_id: str | None = None) -> dict[str, int]:
    counts = {s.value: 0 for s in DecisionStatus}
    for d in memory.list(project_id=project_id):
        counts[d.status.value] += 1
    return counts
