# Owner task: EB-41 Entity resolution cascade
"""Three-stage resolution cascade: strong identifiers → exact normalised name → fuzzy, with a review band.

Policy (why it is conservative): a wrong merge silently mixes two real parties' money and decisions, while a
missed merge only costs a review click. So automatic merges need a strong identifier, an unambiguous exact
name, or a high fuzzy score with a clear margin and no conflicting designator ("Tower A" vs "Tower B").
Everything between "obviously different" and "obviously the same" goes to the review queue.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Sequence

from tenant_context import current_tenant

from resolver import (
    EntityRecord, Mention, Scorer, designators, name_score, normalize_email, normalize_name, normalize_phone,
)

AUTO_MATCH = 0.93
REVIEW_FLOOR = 0.80
MARGIN = 0.05


class Outcome(str, Enum):
    MATCH = "match"
    REVIEW = "review"
    NEW = "new"


@dataclass(frozen=True)
class Candidate:
    entity_id: str
    score: float
    matched_name: str


@dataclass(frozen=True)
class Decision:
    outcome: Outcome
    stage: str
    score: float
    entity_id: str | None = None
    candidates: tuple[Candidate, ...] = ()
    evidence: str = ""


class ResolutionCascade:
    def __init__(self, scorer: Scorer = name_score, auto_match: float = AUTO_MATCH, review_floor: float = REVIEW_FLOOR,
                 margin: float = MARGIN) -> None:
        self.scorer, self.auto_match, self.review_floor, self.margin = scorer, auto_match, review_floor, margin

    def resolve(self, mention: Mention, entities: Sequence[EntityRecord],
                rejected: frozenset[tuple[str, str]] = frozenset()) -> Decision:
        """``rejected`` holds (normalized mention name, entity_id) pairs a reviewer already said are different."""
        tenant = current_tenant().tenant_id
        if mention.tenant_id != tenant:
            raise PermissionError("mention belongs to another tenant")
        pool = [e for e in entities if e.tenant_id == tenant and e.entity_type == mention.entity_type]
        person = mention.entity_type == "person"
        mname = normalize_name(mention.name, person=person)

        # Stage 1 — strong identifiers. Two records with different tax ids never merge, even if names agree.
        strong = self._strong(mention, pool)
        if strong:
            ids = {e.entity_id for e, _ in strong}
            if len(ids) == 1:
                ent, why = strong[0]
                return Decision(Outcome.MATCH, "identifier", 1.0, ent.entity_id, (Candidate(ent.entity_id, 1.0, ent.canonical_name),), why)
            return Decision(Outcome.REVIEW, "identifier", 1.0, None,
                            tuple(Candidate(e.entity_id, 1.0, e.canonical_name) for e, _ in strong),
                            "identifiers point at different entities")

        # Stage 2 — exact normalised name or alias.
        exact = {}
        for e in pool:
            if any(normalize_name(n, person=person) == mname for n in e.names()) and (mname, e.entity_id) not in rejected:
                exact[e.entity_id] = e
        conflicting_tax = lambda e: bool(mention.tax_id and e.tax_id and mention.tax_id.upper() != e.tax_id.upper())  # noqa: E731
        exact = {k: e for k, e in exact.items() if not conflicting_tax(e)}
        if len(exact) == 1:
            e = next(iter(exact.values()))
            return Decision(Outcome.MATCH, "exact", 0.98, e.entity_id, (Candidate(e.entity_id, 0.98, e.canonical_name),),
                            f"normalised name equals {e.canonical_name!r}")
        if len(exact) > 1:
            return Decision(Outcome.REVIEW, "exact", 0.98, None,
                            tuple(Candidate(e.entity_id, 0.98, e.canonical_name) for e in exact.values()),
                            "name is ambiguous between several entities")

        # Stage 3 — fuzzy, only among candidates that are not ruled out.
        scored: list[Candidate] = []
        for e in pool:
            if (mname, e.entity_id) in rejected or conflicting_tax(e):
                continue
            best = max(((self.scorer(mname, normalize_name(n, person=person)), n) for n in e.names()), key=lambda x: x[0])
            conflict = designators(mname) != designators(normalize_name(best[1], person=person)) and (
                designators(mname) or designators(normalize_name(best[1], person=person)))
            score = min(best[0], self.auto_match - 0.001) if conflict else best[0]  # a designator clash can't auto-merge
            scored.append(Candidate(e.entity_id, round(score, 4), best[1]))
        scored.sort(key=lambda c: c.score, reverse=True)
        top = tuple(c for c in scored if c.score >= self.review_floor)[:5]
        if not top:
            return Decision(Outcome.NEW, "fuzzy", scored[0].score if scored else 0.0, None, (), "no similar entity")
        second = top[1].score if len(top) > 1 else 0.0
        if top[0].score >= self.auto_match and top[0].score - second >= self.margin:
            return Decision(Outcome.MATCH, "fuzzy", top[0].score, top[0].entity_id, top,
                            f"similar to {top[0].matched_name!r} ({top[0].score:.2f})")
        return Decision(Outcome.REVIEW, "fuzzy", top[0].score, None, top, "similar but not certain enough to merge")

    @staticmethod
    def _strong(mention: Mention, pool: Sequence[EntityRecord]) -> list[tuple[EntityRecord, str]]:
        hits: list[tuple[EntityRecord, str]] = []
        for e in pool:
            if mention.tax_id and e.tax_id and mention.tax_id.upper() == e.tax_id.upper():
                hits.append((e, f"tax id {mention.tax_id}"))
            elif mention.email and e.email and normalize_email(mention.email) == normalize_email(e.email):
                hits.append((e, f"email {mention.email}"))
            elif mention.phone and e.phone and len(normalize_phone(mention.phone)) == 10 \
                    and normalize_phone(mention.phone) == normalize_phone(e.phone):
                hits.append((e, f"phone {normalize_phone(mention.phone)}"))
        return hits
