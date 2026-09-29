# Owner task: EB-20 RLS and tenant middleware
"""Database session tenant binding helper.

Executes `SET LOCAL app.tenant_id = :tenant_id` on the database session or connection
within a transaction, enforcing PostgreSQL Row-Level Security policies (Risk R-6).
"""

from __future__ import annotations

from typing import Any
from sqlalchemy import text
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
