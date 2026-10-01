# Owner task: EB-20 RLS and tenant middleware
"""Database session tenant binding helper.

Executes `SET LOCAL app.tenant_id = :tenant_id` on the database session or connection
within a transaction, enforcing PostgreSQL Row-Level Security policies (Risk R-6).
"""

from __future__ import annotations

from typing import Any
from sqlalchemy import create_engine, text
from tenant_context import validate_tenant_id


def bind_session_tenant(session_or_conn: Any, tenant_id: str) -> None:
    """Execute `SET LOCAL app.tenant_id = :tenant_id` on the database session/connection.

    Must be called inside an active transaction. Setting app.tenant_id activates
    Postgres Row-Level Security policies for all queries within the transaction.
    """
    validate_tenant_id(tenant_id)
    # SQLAlchemy Session / Connection execution
    if hasattr(session_or_conn, "execute"):
        session_or_conn.execute(
            text("SELECT set_config('app.tenant_id', :tenant_id, true)"),
            {"tenant_id": tenant_id},
        )
    # Raw DB-API cursor / connection execution
    elif hasattr(session_or_conn, "cursor"):
        cursor = session_or_conn.cursor()
        cursor.execute("SELECT set_config('app.tenant_id', %s, true);", (tenant_id,))


def create_app_engine(url: str) -> Any:
    """Engine for the application role. The only place an engine is built outside tests (check_tenant_scope rule 1).

    Refuses a URL whose user is a superuser-style account: the app must connect as ``klarity_app`` (NOBYPASSRLS), or
    row-level security would not apply to it.
    """
    user = (url.split("://", 1)[-1].split("@", 1)[0].split(":", 1)[0]) if "@" in url else ""
    if user in {"postgres", "klarity_admin", "klarity_control", "klarity_infra"}:
        raise ValueError(f"refusing to run the API as {user!r}: use the klarity_app role so row-level security applies")
    return create_engine(url, pool_pre_ping=True)
