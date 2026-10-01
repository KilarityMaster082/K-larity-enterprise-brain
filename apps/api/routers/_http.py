# Owner task: EB-20 RLS and tenant middleware (shared ASGI helpers for routers)
from __future__ import annotations

import json
from typing import Any, Callable


async def read_json(receive: Callable[..., Any], limit: int = 256 * 1024) -> dict[str, Any] | None:
    """Read and parse a JSON object body. None on malformed JSON, non-object, oversize or disconnect."""
    body = bytearray()
    while True:
        message = await receive()
        if message["type"] == "http.disconnect":
            return None
        body.extend(message.get("body", b""))
        if len(body) > limit:
            return None
        if not message.get("more_body", False):
            break
    try:
        data = json.loads(body.decode("utf-8") if body else "{}")
    except Exception:
        return None
    return data if isinstance(data, dict) else None


async def send_json(send: Callable[..., Any], status: int, data: dict[str, Any]) -> None:
    raw = json.dumps(data).encode("utf-8")
    await send({"type": "http.response.start", "status": status,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(raw)).encode("ascii"))]})
    await send({"type": "http.response.body", "body": raw})


async def require_user(scope: dict[str, Any], send: Callable[..., Any]) -> Any | None:
    """The authenticated caller, or send 401 and return None. Every data endpoint calls this first."""
    user = scope.get("state", {}).get("user")
    if user is None:
        await send_json(send, 401, {"error": "authentication_required", "detail": "Sign in to use this endpoint"})
    return user
