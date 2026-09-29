"""Connector type registry: maps a `connector_type` string (stored on each source row) to its class.

Owner task: EB-28 Connector SDK and source registry
Borrowed from: Onyx a18fc1a backend/onyx/connectors/connector_runner.py (MIT) — pattern of
instantiating a connector from a stored source type. Registration is explicit (no import-time magic).
"""

from __future__ import annotations

from .interface import BaseConnector


class ConnectorRegistry:
    def __init__(self) -> None:
        self._types: dict[str, type[BaseConnector]] = {}

    def register(self, cls: type[BaseConnector]) -> type[BaseConnector]:
        """Use as a class decorator. Rejects duplicates and classes missing interface methods."""
        if not (isinstance(cls, type) and issubclass(cls, BaseConnector)):
            raise TypeError(f"{cls!r} does not implement BaseConnector")
        ctype = getattr(cls, "connector_type", None)
        if not ctype:
            raise TypeError(f"{cls.__name__} must set connector_type")
        if getattr(cls, "__abstractmethods__", None):
            raise TypeError(f"{cls.__name__} is missing: {', '.join(sorted(cls.__abstractmethods__))}")
        existing = self._types.get(ctype)
        if existing is not None and existing is not cls:
            raise ValueError(f"connector_type {ctype!r} already registered by {existing.__name__}")
        self._types[ctype] = cls
        return cls

    def get(self, connector_type: str) -> type[BaseConnector]:
        try:
            return self._types[connector_type]
        except KeyError:
            raise KeyError(f"unknown connector_type {connector_type!r}") from None

    def create(self, connector_type: str) -> BaseConnector:
        return self.get(connector_type)()

    def types(self) -> list[str]:
        return sorted(self._types)


default_registry = ConnectorRegistry()
register = default_registry.register
