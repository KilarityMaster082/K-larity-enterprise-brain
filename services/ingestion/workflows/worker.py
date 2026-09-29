# Owner task: EB-29 Temporal ingestion pipeline
"""Ingestion worker managing task queues, tenant fairness, and crash recovery.

Subtask 6: Test: kill worker mid-run resumes without duplicates.
The worker handles durable execution. If terminated or killed mid-batch, subsequent
restarts resume from the persisted state/cursor; already processed items are
skipped via idempotency keys and content-hash checks, guaranteeing zero duplicates.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable

from connectors_sdk import (
    BaseConnector,
    Cursor,
    SourceContext,
    SourceStateStore,
)
from tenant_context import TenantContext, current_tenant_or_none, tenant_scope

from services.ingestion.workflows.dead_letter import DeadLetterStore
from services.ingestion.workflows.pipeline import IngestSourceWorkflow, WorkflowResult


@dataclass
class WorkerStats:
    """Worker operational metrics."""

    jobs_started: int = 0
    jobs_completed: int = 0
    jobs_interrupted: int = 0
    total_items_processed: int = 0
    total_items_skipped: int = 0
    total_items_failed: int = 0


class IngestionWorker:
    """Worker executing durable ingestion pipelines across tenants."""

    def __init__(
        self,
        dead_letter_store: DeadLetterStore | None = None,
        max_concurrent_jobs: int = 10,
    ) -> None:
        self.dead_letter_store = dead_letter_store or DeadLetterStore()
        self.max_concurrent_jobs = max_concurrent_jobs
        self.stats = WorkerStats()
        self._workflow = IngestSourceWorkflow(dead_letter_store=self.dead_letter_store)
        self._is_running = True

    def stop(self) -> None:
        """Stops accepting new work."""
        self._is_running = False

    def execute_sync_job(
        self,
        tenant: TenantContext,
        ctx: SourceContext,
        connector: BaseConnector,
        cursor: Cursor,
        state_store: SourceStateStore | None = None,
        fail_at_stage: dict[str, set[str]] | None = None,
        crash_after_item: int | None = None,
    ) -> WorkflowResult:
        """Executes a single source sync under tenant context with crash resilience."""
        if not self._is_running:
            raise RuntimeError("Worker is stopped")

        self.stats.jobs_started += 1

        with tenant_scope(tenant):
            try:
                res = self._workflow.run(
                    ctx=ctx,
                    connector=connector,
                    cursor=cursor,
                    state_store=state_store,
                    fail_at_stage=fail_at_stage,
                    crash_after_item=crash_after_item,
                )
                self.stats.jobs_completed += 1
                self.stats.total_items_processed += res.items_processed
                self.stats.total_items_skipped += res.items_skipped
                self.stats.total_items_failed += res.items_failed
                return res
            except InterruptedError:
                self.stats.jobs_interrupted += 1
                raise
