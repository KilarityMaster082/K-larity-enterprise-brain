# Owner task: EB-22 OpenFGA authorization model and tuple sync
"""Tuple synchronization from project memberships, roles, and source ACLs.

Translates relational domain state from the database and connectors into OpenFGA relation tuples.
"""

from __future__ import annotations

from typing import Sequence
from storage import FgaStore, TupleKey


class TupleSynchronizer:
    """Synchronizes relational domain entities and memberships to OpenFGA relation tuples."""

    def __init__(self, store: FgaStore) -> None:
        self.store = store

    def sync_tenant_roles(
        self,
        tenant_id: str,
        *,
        admins: Sequence[str] = (),
        finance_viewers: Sequence[str] = (),
        members: Sequence[str] = (),
    ) -> None:
        """Sync tenant-level administrative, financial, and membership roles."""
        t_obj = f"tenant:{tenant_id}"
        writes: list[TupleKey] = []
        for u in admins:
            writes.append(TupleKey(user=f"user:{u}", relation="admin", object=t_obj))
        for u in finance_viewers:
            writes.append(TupleKey(user=f"user:{u}", relation="finance_viewer", object=t_obj))
        for u in members:
            writes.append(TupleKey(user=f"user:{u}", relation="member", object=t_obj))

        self.store.write_tuples(writes=writes)

    def sync_project(
        self,
        tenant_id: str,
        project_id: str,
        *,
        lead_id: str | None = None,
        member_ids: Sequence[str] = (),
    ) -> None:
        """Bind project to parent tenant and assign project lead and team members."""
        proj_obj = f"project:{project_id}"
        writes: list[TupleKey] = [
            TupleKey(user=f"tenant:{tenant_id}", relation="parent", object=proj_obj),
        ]
        if lead_id:
            writes.append(TupleKey(user=f"user:{lead_id}", relation="lead", object=proj_obj))
        for m in member_ids:
            writes.append(TupleKey(user=f"user:{m}", relation="member", object=proj_obj))

        self.store.write_tuples(writes=writes)

    def sync_document(
        self,
        project_id: str,
        document_id: str,
        *,
        direct_viewers: Sequence[str] = (),
        direct_editors: Sequence[str] = (),
    ) -> None:
        """Sync document parent project and any direct source-level ACL overrides."""
        doc_obj = f"document:{document_id}"
        writes: list[TupleKey] = [
            TupleKey(user=f"project:{project_id}", relation="parent", object=doc_obj),
        ]
        for u in direct_viewers:
            writes.append(TupleKey(user=f"user:{u}", relation="viewer", object=doc_obj))
        for u in direct_editors:
            writes.append(TupleKey(user=f"user:{u}", relation="editor", object=doc_obj))

        self.store.write_tuples(writes=writes)

    def sync_financial_record(
        self,
        project_id: str,
        record_id: str,
    ) -> None:
        """Bind sensitive financial invoice/transaction record to its parent project."""
        fin_obj = f"financial_record:{record_id}"
        writes = [
            TupleKey(user=f"project:{project_id}", relation="parent", object=fin_obj),
        ]
        self.store.write_tuples(writes=writes)

    def sync_decision(
        self,
        project_id: str,
        decision_id: str,
    ) -> None:
        """Bind AEC decision record to its parent project."""
        dec_obj = f"decision:{decision_id}"
        writes = [
            TupleKey(user=f"project:{project_id}", relation="parent", object=dec_obj),
        ]
        self.store.write_tuples(writes=writes)
