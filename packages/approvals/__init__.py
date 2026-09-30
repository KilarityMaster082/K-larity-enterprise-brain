# Owner task: EB-66 Approval model skeleton
"""Approval model: no automation side effect runs without a recorded, single-use human approval."""

from .models import (
    ApprovalError, ApprovalKind, ApprovalRequest, ApprovalStatus, InvalidTransitionError, NotAuthorizedError,
    NotFoundError, RequestedVia,
)
from .service import ApprovalService, InMemoryApprovalStore

__all__ = [
    "ApprovalError", "ApprovalKind", "ApprovalRequest", "ApprovalService", "ApprovalStatus", "InMemoryApprovalStore",
    "InvalidTransitionError", "NotAuthorizedError", "NotFoundError", "RequestedVia",
]
