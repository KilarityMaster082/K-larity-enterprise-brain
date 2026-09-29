# Owner task: EB-22 OpenFGA authorization model and tuple sync
"""Permissions client: high-level authorization helpers and check queries.

Wraps the tenant-scoped FgaStore to evaluate fine-grained permissions
for AEC entities (projects, documents, financial records, decisions).
"""

from __future__ import annotations

from storage import FgaStore


class PermissionsClient:
    """High-level permission query interface."""

    def __init__(self, store: FgaStore) -> None:
        self.store = store

    def can_view_project(self, user_id: str, project_id: str) -> bool:
        """Check if user can view the given project."""
        user = f"user:{user_id}"
        obj = f"project:{project_id}"
        return self.store.check(user, "viewer", obj)

    def can_edit_project(self, user_id: str, project_id: str) -> bool:
        """Check if user can edit/manage the given project."""
        user = f"user:{user_id}"
        obj = f"project:{project_id}"
        return self.store.check(user, "editor", obj)

    def can_view_document(self, user_id: str, document_id: str) -> bool:
        """Check if user can view the specified document."""
        user = f"user:{user_id}"
        obj = f"document:{document_id}"
        return self.store.check(user, "viewer", obj)

    def can_edit_document(self, user_id: str, document_id: str) -> bool:
        """Check if user can edit the specified document."""
        user = f"user:{user_id}"
        obj = f"document:{document_id}"
        return self.store.check(user, "editor", obj)

    def can_view_finance(self, user_id: str, project_id: str, record_id: str | None = None) -> bool:
        """Check if user can access financial transactions/budgets on the project."""
        user = f"user:{user_id}"
        obj = f"financial_record:{record_id}" if record_id else f"project:{project_id}"
        return self.store.check(user, "viewer" if record_id else "finance_viewer", obj)

    def can_review_decision(self, user_id: str, decision_id: str) -> bool:
        """Check if user is authorized to review/sign-off on an AEC decision."""
        user = f"user:{user_id}"
        obj = f"decision:{decision_id}"
        return self.store.check(user, "reviewer", obj)

    def list_accessible_projects(self, user_id: str) -> list[str]:
        """List project IDs accessible to the user within the active tenant."""
        user = f"user:{user_id}"
        objects = self.store.list_objects(user, "viewer", "project")
        return [obj.removeprefix("project:") for obj in objects]

    def list_accessible_documents(self, user_id: str) -> list[str]:
        """List document IDs accessible to the user within the active tenant."""
        user = f"user:{user_id}"
        objects = self.store.list_objects(user, "viewer", "document")
        return [obj.removeprefix("document:") for obj in objects]
