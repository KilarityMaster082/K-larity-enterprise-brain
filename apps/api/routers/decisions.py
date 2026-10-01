# Owner task: EB-53 Decision Memory
"""Decision Memory API.

* GET  /api/v1/decisions[?project_id=&status=] — decisions in the caller's tenant, newest first by id.
* POST /api/v1/decisions — {"decision_id", "action": "confirm"|"edit"|"reject", "note"?, "fields"?}.

Enforces: rule 1 (tenant from TenantMiddleware), rule 10 (a human reviews; the reviewer is the *authenticated*
user, never a field in the body), audit on every change (written by DecisionMemory). Reviewing needs the OpenFGA
``reviewer`` relation, so an unauthenticated or unauthorised caller changes nothing.
"""

from __future__ import annotations

import json
from typing import Any, Callable
from urllib.parse import parse_qs

from decision_memory import DecisionError, DecisionStatus, InvalidChange, NotAuthorized, NotFound
from tenant_context import current_tenant

from apps.api.routers._http import read_json, send_json


async def handle_decisions(scope: dict[str, Any], receive: Callable[..., Any], send: Callable[..., Any]) -> None:
    ctx = current_tenant()
    services = scope["state"]["services"]
    services.ensure_demo()
    method = scope.get("method", "GET")

    if method == "GET":
        q = parse_qs(scope.get("query_string", b"").decode("ascii", "ignore"))
        status = None
        if "status" in q:
            try:
                status = DecisionStatus(q["status"][0])
            except ValueError:
                await send_json(send, 400, {"error": "invalid_status"})
                return
        rows = services.decisions.list(project_id=(q.get("project_id") or [None])[0], status=status)
        rows.sort(key=lambda d: d.decision_id)
        await send_json(send, 200, {"tenant_id": ctx.tenant_id, "decisions": [d.to_web() for d in rows]})
        return

    if method != "POST":
        await send_json(send, 405, {"error": "method_not_allowed"})
        return

    user = scope["state"].get("user")
    if user is None:
        await send_json(send, 401, {"error": "authentication_required", "detail": "Reviewing a decision requires a signed-in user"})
        return
    payload = await read_json(receive)
    if payload is None:
        await send_json(send, 400, {"error": "invalid_json"})
        return
    decision_id = str(payload.get("decision_id", "")).strip()
    action = str(payload.get("action", "")).strip().lower()
    if not decision_id or action not in ("confirm", "edit", "reject"):
        await send_json(send, 400, {"error": "invalid_triage_request",
                                    "detail": "decision_id and action (confirm/edit/reject) are required"})
        return
    memory = services.decisions
    try:
        if action == "confirm":
            result = memory.confirm(decision_id, user.user_id, payload.get("note"))
        elif action == "reject":
            result = memory.reject(decision_id, user.user_id, payload.get("note"))
        else:
            fields = payload.get("fields")
            if not isinstance(fields, dict) or not fields:
                await send_json(send, 400, {"error": "invalid_triage_request", "detail": "edit needs a non-empty 'fields' object"})
                return
            result = memory.edit(decision_id, user.user_id, **fields)
    except NotFound:
        await send_json(send, 404, {"error": "not_found"})
    except NotAuthorized as e:
        await send_json(send, 403, {"error": "forbidden", "detail": str(e)})
    except InvalidChange as e:
        await send_json(send, 409, {"error": "invalid_change", "detail": str(e)})
    except DecisionError as e:  # pragma: no cover - defensive
        await send_json(send, 400, {"error": "decision_error", "detail": str(e)})
    else:
        await send_json(send, 200, {"tenant_id": ctx.tenant_id, "action": action, "audited": True,
                                    "decision": result.to_web(), "status": result.status.value})
