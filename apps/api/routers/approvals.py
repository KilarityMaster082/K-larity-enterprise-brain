# Owner task: EB-66 Approval model skeleton
"""Approvals API (rule 10: no automation side effect without an approval).

* GET  /api/v1/approvals[?status=pending]
* POST /api/v1/approvals/{id}/approve | /reject | /cancel   body: {"note"?}

The deciding user is the authenticated user; requesters, agents and unauthorised users are refused by
ApprovalService. Execution (``consume``) is deliberately not an HTTP endpoint — only the workflow that owns the
side effect calls it, immediately before acting.
"""

from __future__ import annotations

from typing import Any, Callable
from urllib.parse import parse_qs

from packages.approvals import ApprovalStatus, InvalidTransitionError, NotAuthorizedError, NotFoundError
from tenant_context import current_tenant

from apps.api.routers._http import read_json, send_json

_ACTIONS = frozenset({"approve", "reject", "cancel"})


async def handle_approvals(scope: dict[str, Any], receive: Callable[..., Any], send: Callable[..., Any]) -> None:
    ctx = current_tenant()
    services = scope["state"]["services"]
    services.ensure_demo()
    method, path = scope.get("method", "GET"), scope.get("path", "")
    svc = services.approvals

    if method == "GET" and path == "/api/v1/approvals":
        q = parse_qs(scope.get("query_string", b"").decode("ascii", "ignore"))
        status = None
        if "status" in q:
            try:
                status = ApprovalStatus(q["status"][0])
            except ValueError:
                await send_json(send, 400, {"error": "invalid_status"})
                return
        await send_json(send, 200, {"tenant_id": ctx.tenant_id, "approvals": [a.to_dict() for a in svc.list(status)]})
        return

    parts = path.strip("/").split("/")  # api v1 approvals {id} {action}
    if method == "POST" and len(parts) == 5 and parts[:3] == ["api", "v1", "approvals"] and parts[4] in _ACTIONS:
        user = scope["state"].get("user")
        if user is None:
            await send_json(send, 401, {"error": "authentication_required"})
            return
        body = await read_json(receive)
        if body is None:
            await send_json(send, 400, {"error": "invalid_json"})
            return
        approval_id, action = parts[3], parts[4]
        try:
            if action == "approve":
                result = svc.approve(approval_id, user.user_id, body.get("note"))
            elif action == "reject":
                result = svc.reject(approval_id, user.user_id, body.get("note"))
            else:
                result = svc.cancel(approval_id, user.user_id)
        except NotFoundError:
            await send_json(send, 404, {"error": "not_found"})
        except NotAuthorizedError as e:
            await send_json(send, 403, {"error": "forbidden", "detail": str(e)})
        except InvalidTransitionError as e:
            await send_json(send, 409, {"error": "invalid_transition", "detail": str(e)})
        else:
            await send_json(send, 200, {"tenant_id": ctx.tenant_id, "approval": result.to_dict()})
        return

    await send_json(send, 404, {"error": "not_found"})
