# Owner task: EB-31 Gmail connector
"""Gmail connector package."""

from services.ingestion.connectors.gmail.auth import GmailCredentials
from services.ingestion.connectors.gmail.connector import GmailConnector
from services.ingestion.connectors.gmail.mapper import GmailMapper

__all__ = ["GmailConnector", "GmailCredentials", "GmailMapper"]
