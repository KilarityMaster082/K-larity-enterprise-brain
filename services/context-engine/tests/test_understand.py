# Owner task: EB-40 Query understanding and intent classes
"""Unit and benchmark tests for query understanding, intent classification, Indian temporal parsing, and multilingual AEC queries."""

from __future__ import annotations

from datetime import datetime, timezone
import json
import pytest

from understand import (
    IntentClass,
    QueryPlan,
    QueryUnderstandingEngine,
    StoreTarget,
    resolve_indian_date_expression,
)


def test_query_plan_schema_export() -> None:
    """Subtask 1: Verifies QueryPlan validation and JSON schema export."""
    plan = QueryPlan(
        raw_query="What is the concrete grade for Tower B?",
        normalized_query="What is the concrete grade for Tower B?",
        intent=IntentClass.LOOKUP,
        entities=["Tower B", "Concrete"],
        target_stores=[StoreTarget.SEARCH, StoreTarget.VECTOR],
        project_id="Tower B",
    )
    assert plan.intent == IntentClass.LOOKUP
    assert StoreTarget.SQL not in plan.target_stores

    schema_str = QueryPlan.export_json_schema()
    schema_dict = json.loads(schema_str)
    assert schema_dict["title"] == "QueryPlan"
    assert "intent" in schema_dict["properties"]
    assert "target_stores" in schema_dict["properties"]


def test_indian_temporal_parsing() -> None:
    """Subtask 2: Tests Indian festival, business calendar, and relative date expressions."""
    ref_date = datetime(2026, 10, 15, tzinfo=timezone.utc)

    # Since Diwali
    tw_diwali = resolve_indian_date_expression("Show certified spend since Diwali", reference_date=ref_date)
    assert tw_diwali is not None
    assert "2025-10-20" in tw_diwali.start_date or "2026-11-08" in tw_diwali.start_date
    assert tw_diwali.relative_expression == "since Diwali"

    # Since Sankranti
    tw_sank = resolve_indian_date_expression("Site issues logged since Sankranti", reference_date=ref_date)
    assert tw_sank is not None
    assert "2026-01-14" in tw_sank.start_date

    # Last month (relative to Oct 15 -> Sept 1 to Sept 30)
    tw_lm = resolve_indian_date_expression("Invoices approved last month", reference_date=ref_date)
    assert tw_lm is not None
    assert "2026-09-01" in tw_lm.start_date
    assert "2026-09-30" in tw_lm.end_date

    # Indian Financial Year Quarter: Q2 FY (July 1 to Sept 30)
    tw_q2 = resolve_indian_date_expression("BOQ consumption in Q2 FY", reference_date=ref_date)
    assert tw_q2 is not None
    assert "2026-07-01" in tw_q2.start_date
    assert "2026-09-30" in tw_q2.end_date


def test_multilingual_hinglish_and_telugu_queries() -> None:
    """Subtask 3: Tests intent detection on mixed Hinglish and Telugu phrasing used on Indian sites."""
    engine = QueryUnderstandingEngine()

    # Hinglish
    p_h1 = engine.analyze_query("Tower B me kitna kharcha hua piling pe")
    assert p_h1.intent == IntentClass.NUMBER
    assert StoreTarget.SQL in p_h1.target_stores
    assert "Tower B" in p_h1.entities

    p_h2 = engine.analyze_query("slab casting kyun delay hua yesterday")
    assert p_h2.intent == IntentClass.INVESTIGATION
    assert StoreTarget.GRAPH in p_h2.target_stores
    assert p_h2.time_window is not None
    assert p_h2.time_window.relative_expression == "yesterday"

    p_h3 = engine.analyze_query("variation order kisne approve kiya")
    assert p_h3.intent == IntentClass.DECISION_HISTORY
    assert StoreTarget.GRAPH in p_h3.target_stores

    # Telugu
    p_t1 = engine.analyze_query("Tower B foundation ki entha karchu ayindi")
    assert p_t1.intent == IntentClass.NUMBER
    assert StoreTarget.SQL in p_t1.target_stores

    p_t2 = engine.analyze_query("concrete pour enduku delay aagipoindi")
    assert p_t2.intent == IntentClass.INVESTIGATION
    assert StoreTarget.GRAPH in p_t2.target_stores

    p_t3 = engine.analyze_query("piling drawing ekkada undi")
    assert p_t3.intent == IntentClass.LOOKUP
    assert StoreTarget.VECTOR in p_t3.target_stores


def test_golden_questions_intent_accuracy_above_90_percent() -> None:
    """Subtask 4 & Acceptance criteria: Correct intent on ≥ 90% of golden questions."""
    golden_set = [
        ("What is the grade of concrete for Tower B foundation piles?", IntentClass.LOOKUP),
        ("Where is the structural drawing for basement columns?", IntentClass.LOOKUP),
        ("Specification for M35 self-compacting concrete as per IS 456", IntentClass.LOOKUP),
        ("Contact details of RMC batching plant manager", IntentClass.LOOKUP),
        ("How much was the total certified spend on piling works?", IntentClass.NUMBER),
        ("What is the total expenditure for Tower B steel reinforcement?", IntentClass.NUMBER),
        ("BOQ amount and rate per metric ton for TMT rebars", IntentClass.NUMBER),
        ("Total certified payout since Diwali", IntentClass.NUMBER),
        ("Why did the foundation piling take 3 weeks longer than scheduled?", IntentClass.INVESTIGATION),
        ("Explain root cause of cold joints reported in basement slab", IntentClass.INVESTIGATION),
        ("Reason for delay in column casting near grid C4", IntentClass.INVESTIGATION),
        ("Why is there a dispute regarding variation order #12?", IntentClass.INVESTIGATION),
        ("Who approved the variation order for extra basement excavation?", IntentClass.DECISION_HISTORY),
        ("Who authorized the change from M30 to M35 grade concrete?", IntentClass.DECISION_HISTORY),
        ("Decision history on choosing ACC over UltraTech for Tower B", IntentClass.DECISION_HISTORY),
        ("When did the structural consultant sign off on Revision 3?", IntentClass.TIMELINE),
        ("What was the timeline of slab casting milestone completion?", IntentClass.TIMELINE),
        ("Curing period schedule for OPC concrete as per NBC", IntentClass.TIMELINE),
        ("Compare vendor quotation rates between Vendor A and Vendor B", IntentClass.COMPARE),
        ("Difference between architectural drawing Rev 1 and Rev 2", IntentClass.COMPARE),
    ]

    engine = QueryUnderstandingEngine()
    correct_count = 0

    for query, expected_intent in golden_set:
        plan = engine.analyze_query(query)
        if plan.intent == expected_intent:
            correct_count += 1
        else:
            print(f"FAILED: '{query}' -> got {plan.intent.value}, expected {expected_intent.value}")

    accuracy = correct_count / len(golden_set)

    # Acceptance criteria: accuracy ≥ 0.90
    assert accuracy >= 0.90
    assert accuracy == 1.0  # 100% on golden set!
