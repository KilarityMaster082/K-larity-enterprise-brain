# Owner task: EB-29 Temporal ingestion pipeline
"""Ingestion schedule definitions and trigger policies.

Subtask 5: Schedules: 5 min chat/mail, hourly files.
  - Chat/mail connectors: 5-minute interval (cron '*/5 * * * *') to catch incoming
    messages, invoices, and RFIs rapidly.
  - File system / object store connectors: hourly interval (cron '0 * * * *') to sync
    document drops, CAD drawings, and contracts without excessive I/O overhead.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class SourceCategory(str, Enum):
    """Categorization of connectors determining sync frequency."""

    CHAT_MAIL = "chat_mail"
    FILE_STORAGE = "file_storage"
    DATABASE = "database"
    CUSTOM = "custom"


@dataclass(frozen=True)
class ScheduleConfig:
    """Schedule specification for recurring Temporal ingestion workflows."""

    schedule_id: str
    connector_type: str
    category: SourceCategory
    interval_seconds: int
    cron_expression: str
    catchup_window_seconds: int = 86400
    jitter_seconds: int = 15


CHAT_MAIL_CONNECTORS = frozenset({
    "gmail",
    "imap",
    "whatsapp",
    "whatsapp_cloud",
    "slack",
    "teams",
    "email",
})

FILE_STORAGE_CONNECTORS = frozenset({
    "file_drop",
    "drive",
    "google_drive",
    "onedrive",
    "s3",
    "box",
    "sharepoint",
    "dropbox",
})


def get_schedule_for_connector(connector_type: str, schedule_id: str | None = None) -> ScheduleConfig:
    """Determines default sync schedule based on connector type (5 min chat/mail, hourly files)."""
    clean_type = connector_type.strip().lower()
    sid = schedule_id or f"sched-{clean_type}"

    if clean_type in CHAT_MAIL_CONNECTORS:
        return ScheduleConfig(
            schedule_id=sid,
            connector_type=clean_type,
            category=SourceCategory.CHAT_MAIL,
            interval_seconds=300,  # 5 minutes
            cron_expression="*/5 * * * *",
            catchup_window_seconds=86400,
            jitter_seconds=10,
        )

    if clean_type in FILE_STORAGE_CONNECTORS:
        return ScheduleConfig(
            schedule_id=sid,
            connector_type=clean_type,
            category=SourceCategory.FILE_STORAGE,
            interval_seconds=3600,  # 1 hour
            cron_expression="0 * * * *",
            catchup_window_seconds=86400 * 7,
            jitter_seconds=60,
        )

    # Default schedule: Hourly
    return ScheduleConfig(
        schedule_id=sid,
        connector_type=clean_type,
        category=SourceCategory.CUSTOM,
        interval_seconds=3600,
        cron_expression="0 * * * *",
        catchup_window_seconds=86400,
    )


class IngestionScheduleRegistry:
    """In-memory schedule registry tracking registered ingestion triggers."""

    def __init__(self) -> None:
        self._schedules: dict[str, ScheduleConfig] = {}

    def register(self, tenant_id: str, source_id: str, connector_type: str) -> ScheduleConfig:
        key = f"{tenant_id}:{source_id}"
        config = get_schedule_for_connector(connector_type, schedule_id=f"sched-{key}")
        self._schedules[key] = config
        return config

    def get(self, tenant_id: str, source_id: str) -> ScheduleConfig | None:
        return self._schedules.get(f"{tenant_id}:{source_id}")

    def list_for_tenant(self, tenant_id: str) -> list[ScheduleConfig]:
        prefix = f"{tenant_id}:"
        return [cfg for k, cfg in self._schedules.items() if k.startswith(prefix)]

    def clear(self) -> None:
        self._schedules.clear()
