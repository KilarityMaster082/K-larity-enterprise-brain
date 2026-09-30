# Owner task: EB-40 Query understanding and intent classes
"""Query understanding turning natural language questions into structured QueryPlans.

Enforces:
- Intent classification: lookup, number, timeline, investigation, decision_history, compare.
- Multi-store routing targets: vector (Qdrant), search (OpenSearch), sql (Ledger/BOQ), graph (Neo4j/RDF).
- Indian cultural date parsing: 'since Diwali', 'since Sankranti', 'last month', 'Q2 FY'.
- Hinglish and Telugu AEC phrasing normalization.
- Pydantic QueryPlan schema with JSON export.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from enum import Enum
import json
import logging
import re
from typing import Any, Callable, Sequence
from pydantic import BaseModel, ConfigDict, Field

try:
    from router import LlmRouter, ModelAlias
except ImportError:
    try:
        from services.llm_gateway.router import LlmRouter, ModelAlias  # type: ignore
    except ImportError:
        class ModelAlias:  # type: ignore
            FAST = "fast"
        class LlmRouter:  # type: ignore
            def complete(self, *args, **kwargs):
                raise NotImplementedError()

logger = logging.getLogger(__name__)


class IntentClass(str, Enum):
    """Core query intent categories."""

    LOOKUP = "lookup"
    NUMBER = "number"
    TIMELINE = "timeline"
    INVESTIGATION = "investigation"
    DECISION_HISTORY = "decision_history"
    COMPARE = "compare"


class StoreTarget(str, Enum):
    """Underlying data and storage backends."""

    VECTOR = "vector"  # Qdrant dense vector index
    SEARCH = "search"  # OpenSearch lexical BM25 index
    SQL = "sql"  # PostgreSQL / SQLite relational ledger
    GRAPH = "graph"  # Knowledge graph ontology traversal


class TimeWindow(BaseModel):
    """Resolved time boundary filter."""

    model_config = ConfigDict(populate_by_name=True)

    start_date: str | None = Field(default=None, description="ISO 8601 start date")
    end_date: str | None = Field(default=None, description="ISO 8601 end date")
    relative_expression: str | None = Field(default=None, description="Raw expression e.g. 'since Diwali'")


class QueryPlan(BaseModel):
    """Structured plan instructing the Context Engine how and where to retrieve context."""

    model_config = ConfigDict(populate_by_name=True)

    raw_query: str = Field(..., description="Original user prompt")
    normalized_query: str = Field(..., description="Cleaned English representation")
    intent: IntentClass = Field(..., description="Classified intent")
    entities: list[str] = Field(default_factory=list, description="Extracted entities (projects, vendors, codes)")
    target_stores: list[StoreTarget] = Field(..., description="Stores to query")
    time_window: TimeWindow | None = Field(default=None, description="Temporal constraint if any")
    project_id: str | None = Field(default=None, description="Scoped project code if detected")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0, description="Intent classification confidence")

    @classmethod
    def export_json_schema(cls) -> str:
        return json.dumps(cls.model_json_schema(), indent=2)


# Indian Cultural & AEC Date Expression Matchers
def resolve_indian_date_expression(text: str, reference_date: datetime | None = None) -> TimeWindow | None:
    """Resolves Indian business and cultural festival date expressions."""
    ref = reference_date or datetime(2026, 10, 1, tzinfo=timezone.utc)
    t_lower = text.lower()

    # Diwali: In 2025: Oct 20; in 2026: Nov 8
    if "since diwali" in t_lower or "after diwali" in t_lower:
        start = datetime(2025, 10, 20, tzinfo=timezone.utc) if ref.month < 11 else datetime(2026, 11, 8, tzinfo=timezone.utc)
        return TimeWindow(start_date=start.isoformat(), end_date=ref.isoformat(), relative_expression="since Diwali")

    # Sankranti / Pongal: Jan 14
    if "since sankranti" in t_lower or "since pongal" in t_lower:
        start = datetime(ref.year, 1, 14, tzinfo=timezone.utc)
        return TimeWindow(start_date=start.isoformat(), end_date=ref.isoformat(), relative_expression="since Sankranti")

    # Last month
    if "last month" in t_lower:
        first_of_this_month = ref.replace(day=1)
        last_month_end = first_of_this_month - timedelta(days=1)
        last_month_start = last_month_end.replace(day=1)
        return TimeWindow(
            start_date=last_month_start.isoformat(),
            end_date=last_month_end.isoformat(),
            relative_expression="last month",
        )

    # Yesterday
    if "yesterday" in t_lower:
        yest = ref - timedelta(days=1)
        return TimeWindow(
            start_date=yest.replace(hour=0, minute=0, second=0).isoformat(),
            end_date=yest.replace(hour=23, minute=59, second=59).isoformat(),
            relative_expression="yesterday",
        )

    # Last quarter / Q1, Q2, Q3, Q4 FY
    fy_match = re.search(r"\b(q[1-4])\s*(?:fy\s*(\d{2,4}))?\b", t_lower)
    if fy_match:
        quarter = fy_match.group(1).upper()
        # Indian Financial Year starts April 1: Q1 (Apr-Jun), Q2 (Jul-Sep), Q3 (Oct-Dec), Q4 (Jan-Mar)
        q_map = {
            "Q1": (4, 1, 6, 30),
            "Q2": (7, 1, 9, 30),
            "Q3": (10, 1, 12, 31),
            "Q4": (1, 1, 3, 31),
        }
        sm, sd, em, ed = q_map[quarter]
        start = datetime(ref.year, sm, sd, tzinfo=timezone.utc)
        end = datetime(ref.year, em, ed, 23, 59, 59, tzinfo=timezone.utc)
        return TimeWindow(start_date=start.isoformat(), end_date=end.isoformat(), relative_expression=quarter)

    return None


class QueryUnderstandingEngine:
    """Parses natural language prompts into executable QueryPlans."""

    # Multilingual lexicons for Indian AEC sites
    HINGLISH_PATTERNS: list[tuple[str, IntentClass, str]] = [
        (r"\b(?:kitna|kitne)\s+(?:kharcha|paisa|cost|rate|amount|bill)\b", IntentClass.NUMBER, "What is the expenditure/cost?"),
        (r"\b(?:kyun|kyu|kaiko)\s+(?:delay|late|ruk gaya|aagaya)\b", IntentClass.INVESTIGATION, "Why was it delayed?"),
        (r"\b(?:kisne|kiske)\s+(?:approve|sign|permission|order)\b", IntentClass.DECISION_HISTORY, "Who approved or gave orders?"),
        (r"\b(?:kahan|kidhar)\s+(?:hai|rakha)\s+(?:drawing|spec|sheet|file)\b", IntentClass.LOOKUP, "Where is the drawing/file?"),
        (r"\b(?:kab|kis tareekh)\s+(?:complete|hoga|khatam|hua)\b", IntentClass.TIMELINE, "When will it complete?"),
    ]

    TELUGU_PATTERNS: list[tuple[str, IntentClass, str]] = [
        (r"\b(?:entha|enni)\s+(?:karchu|ayindi|bill|dabbu)\b", IntentClass.NUMBER, "What is the expenditure/cost?"),
        (r"\b(?:enduku|endhuku)\s+(?:late|aagipoindi|delay)\b", IntentClass.INVESTIGATION, "Why was it delayed?"),
        (r"\b(?:evaru|evaritho)\s+(?:sign|chepparu|approve)\b", IntentClass.DECISION_HISTORY, "Who approved or decided?"),
        (r"\b(?:ekkada|ekada)\s+(?:undi|pettaru)\b", IntentClass.LOOKUP, "Where is it located?"),
        (r"\b(?:eppudu|yeppudu)\s+(?:start|avtundi|complete)\b", IntentClass.TIMELINE, "When will it complete?"),
    ]

    # Standard English Regex Classifiers
    INTENT_KEYWORDS: dict[IntentClass, list[str]] = {
        IntentClass.NUMBER: [
            r"\bhow much\b",
            r"\btotal (?:spend|cost|amount|expenditure|bill|certified)\b",
            r"\bquantity\b",
            r"\brate per\b",
            r"\bboq amount\b",
            r"\bgst amount\b",
        ],
        IntentClass.INVESTIGATION: [
            r"\bwhy\b",
            r"\broot cause\b",
            r"\breason for delay\b",
            r"\bexplain dispute\b",
            r"\bconflict\b",
            r"\bvariation justification\b",
        ],
        IntentClass.DECISION_HISTORY: [
            r"\bwho (?:approved|signed|authori[sz]ed|ordered)\b",
            r"\bdecision history\b",
            r"\bwhy did we choose\b",
            r"\badr\b",
            r"\bminutes of meeting\b",
        ],
        IntentClass.TIMELINE: [
            r"\bwhen (?:did|was|will|is)\b",
            r"\btimeline\b",
            r"\bschedule\b",
            r"\bmilestone date\b",
            r"\brevision date\b",
            r"\bcuring period\b",
        ],
        IntentClass.COMPARE: [
            r"\bcompare\b",
            r"\bdifference between\b",
            r"\bvariance between\b",
            r"\bversus\b",
            r"\bvs\b",
        ],
        IntentClass.LOOKUP: [
            r"\bwhat is the grade\b",
            r"\bwhere is\b",
            r"\bcontact details\b",
            r"\bspecification for\b",
            r"\bdrawing number\b",
        ],
    }

    def __init__(self, router: LlmRouter | None = None) -> None:
        self.router = router or LlmRouter()

    def analyze_query(
        self,
        query: str,
        reference_date: datetime | None = None,
        mock_invoker: Callable[[str, list[dict[str, str]]], str] | None = None,
    ) -> QueryPlan:
        """Parses query string into a validated QueryPlan."""
        q_clean = query.strip()
        q_lower = q_clean.lower()

        # 1. Resolve Indian temporal expressions
        time_window = resolve_indian_date_expression(q_clean, reference_date=reference_date)

        # 2. Multilingual translation & intent detection (Hinglish & Telugu)
        normalized = q_clean
        detected_intent: IntentClass | None = None

        for pattern, intent, en_trans in self.HINGLISH_PATTERNS:
            if re.search(pattern, q_lower):
                detected_intent = intent
                normalized = f"{en_trans} ({q_clean})"
                break

        if not detected_intent:
            for pattern, intent, en_trans in self.TELUGU_PATTERNS:
                if re.search(pattern, q_lower):
                    detected_intent = intent
                    normalized = f"{en_trans} ({q_clean})"
                    break

        # 3. English rule matching if not multilingual
        if not detected_intent:
            for intent, patterns in self.INTENT_KEYWORDS.items():
                if any(re.search(p, q_lower) for p in patterns):
                    detected_intent = intent
                    break

        # Fallback default
        if not detected_intent:
            if any(w in q_lower for w in ["what", "which", "who", "where"]):
                detected_intent = IntentClass.LOOKUP
            else:
                detected_intent = IntentClass.INVESTIGATION

        # 4. Extract Project ID and Named Entities
        entities: list[str] = []
        project_id: str | None = None

        # Project pattern (e.g. Tower B, Studio 8, Villa 14, PRJ-TB)
        proj_match = re.search(r"\b(tower\s+[a-z0-9]+|studio\s+[0-9]+|villa\s+[0-9]+|prj-[a-z0-9]+)\b", q_lower)
        if proj_match:
            project_id = proj_match.group(1).title()
            entities.append(project_id)

        # Drawing or code patterns (e.g. IS 456, NBC 2016, DWG-002)
        code_matches = re.findall(r"\b(?:is\s*\d+|nbc\s*\d+|dwg-[a-z0-9]+)\b", q_lower)
        for cm in code_matches:
            entities.append(cm.upper())

        # Material entities (concrete, steel, rebar, pile, slab, rmc)
        materials = ["concrete", "steel", "rebar", "pile", "slab", "rmc", "cement", "pump"]
        for mat in materials:
            if re.search(rf"\b{mat}\b", q_lower):
                entities.append(mat.capitalize())

        # 5. Target Stores Mapping
        target_stores: list[StoreTarget] = [StoreTarget.SEARCH]
        if detected_intent in (IntentClass.NUMBER,):
            target_stores.append(StoreTarget.SQL)
            target_stores.append(StoreTarget.VECTOR)
        elif detected_intent in (IntentClass.INVESTIGATION, IntentClass.DECISION_HISTORY):
            target_stores.append(StoreTarget.VECTOR)
            target_stores.append(StoreTarget.GRAPH)
        elif detected_intent in (IntentClass.TIMELINE, IntentClass.COMPARE):
            target_stores.append(StoreTarget.GRAPH)
            target_stores.append(StoreTarget.VECTOR)
        else:
            target_stores.append(StoreTarget.VECTOR)

        plan = QueryPlan(
            raw_query=q_clean,
            normalized_query=normalized,
            intent=detected_intent,
            entities=list(dict.fromkeys(entities)),
            target_stores=list(dict.fromkeys(target_stores)),
            time_window=time_window,
            project_id=project_id,
            confidence=0.95,
        )

        return plan
