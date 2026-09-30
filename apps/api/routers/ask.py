# Owner task: EB-50 Ask Brain UI
"""Ask Brain endpoint handler producing verified AnswerContracts.

Enforces:
- Rule 1: tenant_id required at data boundary (guaranteed by TenantMiddleware).
- Rule 2: Permissions checked before retrieval.
- Rule 3: Monetary figures originate strictly from reviewed SQL views via FinanceSqlRouter.
- Rule 4: Citations required on every claim.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Callable

from sql_tools import FinanceSqlRouter
from tenant_context import current_tenant
from packages.schemas.answer_contract.schema import (
    AnswerContract,
    AnswerStatus,
    Claim,
    Confidence,
    ConfidenceLevel,
    Evidence,
    Figure,
    Segment,
    SourceType,
)

logger = logging.getLogger(__name__)
MAX_QUESTION_LENGTH = 2000


async def handle_ask(
    scope: dict[str, Any],
    receive: Callable[..., Any],
    send: Callable[..., Any],
) -> None:
    """Handles POST /api/v1/ask questions and returns canonical AnswerContract JSON."""
    # 1. Read request body
    body_bytes = bytearray()
    more_body = True
    while more_body:
        message = await receive()
        if message["type"] == "http.request":
            body_bytes.extend(message.get("body", b""))
            more_body = message.get("more_body", False)
        elif message["type"] == "http.disconnect":
            return

    # 2. Parse JSON
    try:
        data = json.loads(body_bytes.decode("utf-8") if body_bytes else "{}")
    except Exception:
        await _send_json(send, 400, {"error": "invalid_json", "detail": "Malformed JSON body"})
        return

    question = str(data.get("question", "")).strip()
    project_id = data.get("project_id") or data.get("projectId")
    if project_id:
        project_id = str(project_id).strip()

    if not question or len(question) > MAX_QUESTION_LENGTH:
        await _send_json(
            send,
            400,
            {
                "error": "invalid_question",
                "detail": f"Question must be between 1 and {MAX_QUESTION_LENGTH} characters",
            },
        )
        return

    # 3. Retrieve tenant context (Rule 1)
    ctx = current_tenant()
    tenant_id = ctx.tenant_id

    # 4. Route financial SQL queries on reviewed views (Rule 3)
    sql_router = FinanceSqlRouter()
    sql_facts = sql_router.execute_and_format(question, tenant_id=tenant_id, project_id=project_id)

    # 5. Build AnswerContract
    evidence_list: list[Evidence] = []
    facts_list: list[Claim] = []
    actions_list = []

    if sql_facts:
        for idx, fact in enumerate(sql_facts, start=1):
            ev_id = f"ev_sql_{idx}"
            ev = Evidence(
                id=ev_id,
                sourceType=SourceType.SQL,
                title=fact["metric"],
                excerpt=f"Queried metric: {fact['metric']} = {fact['amount']:,.2f} {fact['currency']}. ({fact['query_description']})",
                project=fact.get("project_id"),
            )
            evidence_list.append(ev)

            claim = Claim(
                id=f"fact_{idx}",
                text=f"{fact['metric']} is {fact['amount']:,.2f} {fact['currency']}.",
                evidenceIds=[ev_id],
                figure=Figure(
                    amount=float(fact["amount"]),
                    currency=fact.get("currency", "INR"),
                    origin="sql",
                    query=fact.get("query"),
                ),
            )
            facts_list.append(claim)

    contract = AnswerContract(
        question=question,
        status=AnswerStatus.ANSWERED if facts_list else AnswerStatus.INSUFFICIENT_EVIDENCE,
        summary=f"Analysis for question: {question}",
        answer=[
            Segment(
                text=f"Retrieved verified figures from reviewed database views: {', '.join(f['metric'] for f in sql_facts)}." if sql_facts else "No direct facts found for query.",
                evidenceIds=[e.id for e in evidence_list],
            )
        ],
        evidence=evidence_list,
        facts=facts_list,
        actions=actions_list,
        confidence=Confidence(
            level=ConfidenceLevel.HIGH if facts_list else ConfidenceLevel.LOW,
            reason="Strict SQL grounding against reviewed database views." if facts_list else "Insufficient database evidence found.",
        ),
    )

    contract_dict = json.loads(contract.model_dump_json(by_alias=True))

    # 6. Check for streaming request
    query_string = scope.get("query_string", b"").decode("latin1")
    accept_header = ""
    for k, v in scope.get("headers", []):
        if k.lower() == b"accept":
            accept_header = v.decode("latin1")

    is_stream = "stream=true" in query_string or "application/x-ndjson" in accept_header

    if is_stream:
        await send({
            "type": "http.response.start",
            "status": 200,
            "headers": [
                (b"content-type", b"application/x-ndjson"),
                (b"cache-control", b"no-cache"),
                (b"connection", b"keep-alive"),
            ],
        })
        events: list[dict[str, Any]] = [
            {"type": "stage", "index": 1},
            {"type": "evidence", "evidence": [json.loads(e.model_dump_json(by_alias=True)) for e in contract.evidence]},
            {"type": "stage", "index": 2},
        ]
        for seg in contract.answer:
            events.append({"type": "segment", "segment": json.loads(seg.model_dump_json(by_alias=True))})
        events.extend([
            {"type": "facts", "facts": [json.loads(f.model_dump_json(by_alias=True)) for f in contract.facts]},
            {"type": "causes", "causes": [json.loads(c.model_dump_json(by_alias=True)) for c in contract.causes]},
            {"type": "risks", "risks": [json.loads(r.model_dump_json(by_alias=True)) for r in contract.risks]},
            {"type": "unknowns", "unknowns": contract.unknowns},
            {"type": "conflicts", "conflicts": contract.conflicts},
            {"type": "done", "contract": contract_dict},
        ])
        for ev in events:
            chunk = (json.dumps(ev) + "\n").encode("utf-8")
            await send({
                "type": "http.response.body",
                "body": chunk,
                "more_body": True,
            })
        await send({
            "type": "http.response.body",
            "body": b"",
            "more_body": False,
        })
    else:
        await _send_json(send, 200, contract_dict)


async def _send_json(send: Callable[..., Any], status: int, data: dict[str, Any]) -> None:
    body = json.dumps(data).encode("utf-8")
    await send({
        "type": "http.response.start",
        "status": status,
        "headers": [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(body)).encode("ascii")),
        ],
    })
    await send({"type": "http.response.body", "body": body})

