# Owner task: EB-41 Entity resolution cascade
"""Name normalisation, similarity scoring and the record types the cascade works on.

Pure functions, no I/O, no model calls — resolution must be reproducible and explainable (every decision
carries the stage and the evidence that produced it). Splink (probabilistic matching) is the planned drop-in
behind ``Scorer`` once its licence review and CI approval land (CLAUDE.md rule 7); until then a deterministic
Jaro-Winkler + token-set blend is used.

Borrowed from: Rowboat entity/alias pattern (R1, R3) — canonical entity with alias surface forms and source refs.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Protocol

# Legal-form and honorific tokens carry no identity in Indian AEC names.
_LEGAL = frozenset({"pvt", "private", "ltd", "limited", "llp", "inc", "co", "company", "corp", "corporation",
                    "opc", "ms", "m", "s", "and", "the"})
_HONORIFIC = frozenset({"mr", "mrs", "ms", "miss", "shri", "sri", "smt", "dr", "er", "ar", "prof", "eng", "sh"})
_DESIGNATOR = re.compile(r"^(\d+|[a-z])$")  # tower A / phase 2 / block 3: a one-token difference is a different thing


def normalize_name(name: str, *, person: bool = False) -> str:
    text = unicodedata.normalize("NFKD", name)
    text = "".join(c for c in text if not unicodedata.combining(c)).casefold()
    text = re.sub(r"[^\w\s]", " ", text).replace("_", " ")
    drop = _LEGAL | (_HONORIFIC if person else frozenset())
    tokens = [t for t in text.split() if t not in drop or len(text.split()) <= 1]
    # "construction" vs "constructions": fold a trailing plural s on longer tokens.
    tokens = [t[:-1] if len(t) > 4 and t.endswith("s") else t for t in tokens]
    return " ".join(tokens)


def normalize_phone(phone: str) -> str:
    digits = re.sub(r"\D", "", phone)
    return digits[-10:] if len(digits) >= 10 else digits  # drop +91 / 0 prefixes


def normalize_email(email: str) -> str:
    return email.strip().casefold()


def jaro_winkler(a: str, b: str) -> float:
    if a == b:
        return 1.0
    if not a or not b:
        return 0.0
    window = max(len(a), len(b)) // 2 - 1
    a_flags, b_flags = [False] * len(a), [False] * len(b)
    matches = 0
    for i, ca in enumerate(a):
        for j in range(max(0, i - window), min(len(b), i + window + 1)):
            if not b_flags[j] and b[j] == ca:
                a_flags[i] = b_flags[j] = True
                matches += 1
                break
    if not matches:
        return 0.0
    t, k = 0, 0
    for i, flag in enumerate(a_flags):
        if flag:
            while not b_flags[k]:
                k += 1
            t += a[i] != b[k]
            k += 1
    jaro = (matches / len(a) + matches / len(b) + (matches - t / 2) / matches) / 3
    prefix = 0
    for ca, cb in zip(a[:4], b[:4]):
        if ca != cb:
            break
        prefix += 1
    return jaro + prefix * 0.1 * (1 - jaro)


def token_set_ratio(a: str, b: str) -> float:
    ta, tb = set(a.split()), set(b.split())
    if not ta or not tb:
        return 0.0
    inter = ta & tb
    base = " ".join(sorted(inter))
    joined_a, joined_b = (base + " " + " ".join(sorted(ta - inter))).strip(), (base + " " + " ".join(sorted(tb - inter))).strip()
    return max(jaro_winkler(base, joined_a) if base else 0.0, jaro_winkler(base, joined_b) if base else 0.0,
               jaro_winkler(joined_a, joined_b))


def name_score(a: str, b: str) -> float:
    """0..1 blend used by the fuzzy stage. Inputs must already be normalised."""
    return 0.5 * jaro_winkler(a, b) + 0.5 * token_set_ratio(a, b)


def designators(normalized: str) -> frozenset[str]:
    return frozenset(t for t in normalized.split() if _DESIGNATOR.match(t))


class Scorer(Protocol):
    def __call__(self, a: str, b: str) -> float: ...


@dataclass(frozen=True)
class Mention:
    """A name seen in a source (email header, WhatsApp sender, sheet cell) awaiting resolution."""

    tenant_id: str
    entity_type: str
    name: str
    source_ref: str
    email: str | None = None
    phone: str | None = None
    tax_id: str | None = None  # GSTIN / PAN


@dataclass(frozen=True)
class EntityRecord:
    tenant_id: str
    entity_id: str
    entity_type: str
    canonical_name: str
    aliases: tuple[str, ...] = ()
    email: str | None = None
    phone: str | None = None
    tax_id: str | None = None

    def names(self) -> tuple[str, ...]:
        return (self.canonical_name, *self.aliases)
