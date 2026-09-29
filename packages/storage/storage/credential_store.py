"""Connector credential store: per-tenant envelope-encrypted secrets with OAuth refresh under a lock.

Owner task: EB-85 Tenant registry and control plane
Borrowed from: Activepieces 611db01a server/api/src/app/app-connection (MIT, A9) —
app-connection.handler.ts `lockAndRefreshConnection`: take a lock per connection, re-read and re-check
expiry inside it (another worker may have refreshed already), refresh, save; on an auth error mark the
connection ERROR so it is not refreshed again. oauth2-util.ts `isExpired`: refresh 15 minutes early.
Adapted: secrets are sealed per tenant (storage/envelope.py) instead of with one platform key; the lock
key is (tenant_id, credential_id); rows carry a version and saves are compare-and-set.

Secrets leave this store only as `Secret`, which redacts itself in repr/str and refuses pickling, so it
cannot slip into logs, Temporal payloads or exception messages. Pass credential ids between processes,
never secrets. Postgres table: db/migrations/0003_connector_credentials.sql (FORCE RLS).
FileCredentialBackend serves development and tests; its lock is per process only.
"""

from __future__ import annotations

import json
import os
import threading
from collections.abc import Callable, Iterator, Mapping
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Protocol

from tenant_context import TenantScopedStore, validate_tenant_id

from .envelope import Envelope, KeyProvider, open_envelope, seal

REFRESH_SKEW = timedelta(minutes=15)
_PURPOSE = "connector-credential"


class CredentialError(Exception):
    pass


class CredentialNotFoundError(CredentialError):
    pass


class CredentialNeedsReauthError(CredentialError):
    """The tenant must re-authorise; nothing will retry this credential until then."""


class ConcurrentUpdateError(CredentialError):
    pass


class CredentialStatus(str, Enum):
    ACTIVE = "active"
    NEEDS_REAUTH = "needs_reauth"


@dataclass(frozen=True)
class CredentialMeta:
    """Everything about a credential except the secret. Safe to log and show in the admin UI."""

    credential_id: str
    connector_type: str
    display_name: str
    version: int
    status: CredentialStatus
    expires_at: str | None
    created_at: str
    updated_at: str


class Secret(Mapping[str, Any]):
    """Read-only decrypted secret. Redacted when printed; cannot be pickled."""

    __slots__ = ("_data",)

    def __init__(self, data: Mapping[str, Any]) -> None:
        object.__setattr__(self, "_data", dict(data))

    def __getitem__(self, key: str) -> Any:
        return self._data[key]

    def __iter__(self) -> Iterator[str]:
        return iter(self._data)

    def __len__(self) -> int:
        return len(self._data)

    def __repr__(self) -> str:
        return f"Secret(<redacted: {len(self._data)} fields>)"

    __str__ = __repr__

    def __reduce__(self) -> Any:
        raise TypeError("Secret cannot be pickled; pass the credential_id instead")

    def __setattr__(self, name: str, value: Any) -> None:
        raise AttributeError("Secret is read-only")


class CredentialBackend(Protocol):
    def load(self, tenant_id: str, credential_id: str) -> dict[str, Any] | None: ...
    def save(self, tenant_id: str, credential_id: str, row: dict[str, Any], expected_version: int) -> None:
        """Compare-and-set: raise ConcurrentUpdateError unless the stored version is `expected_version`
        (0 = must not exist)."""
        ...
    def delete(self, tenant_id: str, credential_id: str) -> None: ...
    def list(self, tenant_id: str) -> list[dict[str, Any]]: ...
    def lock(self, tenant_id: str, credential_id: str) -> AbstractContextManager[None]: ...


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _context(tenant_id: str, credential_id: str) -> dict[str, str]:
    return {"purpose": _PURPOSE, "tenant_id": tenant_id, "credential_id": credential_id}


def _meta(row: Mapping[str, Any]) -> CredentialMeta:
    return CredentialMeta(row["credential_id"], row["connector_type"], row["display_name"], row["version"],
                          CredentialStatus(row["status"]), row.get("expires_at"), row["created_at"],
                          row["updated_at"])


class CredentialStore(TenantScopedStore):
    def __init__(self, backend: CredentialBackend, keys: KeyProvider,
                 clock: Callable[[], datetime] = _now) -> None:
        self._backend = backend
        self._keys = keys
        self._clock = clock

    # -- internals (unguarded helpers; every public method below is guarded) ------------------------------
    def _row(self, credential_id: str) -> dict[str, Any]:
        row = self._backend.load(self._tenant().tenant_id, credential_id)
        if row is None:
            raise CredentialNotFoundError(credential_id)
        return row

    def _open(self, row: Mapping[str, Any]) -> Secret:
        tenant_id = self._tenant().tenant_id
        env = Envelope.from_dict(row["envelope"])
        if env.key_ref != self._placement().kms_key_ref:
            raise CredentialError("credential is sealed under a key that does not belong to this tenant")
        plain = open_envelope(self._keys, env, _context(tenant_id, row["credential_id"]))
        return Secret(json.loads(plain))

    def _write(self, credential_id: str, secret: Mapping[str, Any], *, connector_type: str, display_name: str,
               expires_at: datetime | None, prev: Mapping[str, Any] | None) -> CredentialMeta:
        tenant_id = self._tenant().tenant_id
        plain = json.dumps(dict(secret), sort_keys=True).encode()
        env = seal(self._keys, self._placement().kms_key_ref, plain, _context(tenant_id, credential_id))
        now = self._clock().isoformat()
        row = {
            "credential_id": credential_id, "connector_type": connector_type, "display_name": display_name,
            "version": (prev["version"] if prev else 0) + 1, "status": CredentialStatus.ACTIVE.value,
            "expires_at": expires_at.isoformat() if expires_at else None,
            "created_at": prev["created_at"] if prev else now, "updated_at": now, "envelope": env.to_dict(),
        }
        self._backend.save(tenant_id, credential_id, row, prev["version"] if prev else 0)
        return _meta(row)

    def _expiring(self, row: Mapping[str, Any], skew: timedelta) -> bool:
        exp = row.get("expires_at")
        return exp is not None and self._clock() + skew >= datetime.fromisoformat(exp)

    # -- public API --------------------------------------------------------------------------------------
    def put(self, credential_id: str, secret: Mapping[str, Any], *, connector_type: str, display_name: str,
            expires_at: datetime | None = None) -> CredentialMeta:
        """Create or replace (e.g. after the tenant re-authorises). Resets status to ACTIVE."""
        validate_tenant_id(credential_id)  # same shape rules: it appears in keys and lock names
        prev = self._backend.load(self._tenant().tenant_id, credential_id)
        return self._write(credential_id, secret, connector_type=connector_type, display_name=display_name,
                           expires_at=expires_at, prev=prev)

    def get(self, credential_id: str) -> Secret:
        row = self._row(credential_id)
        if row["status"] == CredentialStatus.NEEDS_REAUTH.value:
            raise CredentialNeedsReauthError(credential_id)
        return self._open(row)

    def get_fresh(self, credential_id: str, refresh: Callable[[Secret], tuple[Mapping[str, Any], datetime | None]],
                  *, reauth_errors: tuple[type[BaseException], ...] = (),
                  skew: timedelta = REFRESH_SKEW) -> Secret:
        """Return the secret, refreshing it first if it expires within `skew`. One refresh per credential
        at a time; a refresher error listed in `reauth_errors` marks the credential NEEDS_REAUTH."""
        row = self._row(credential_id)
        if not self._expiring(row, skew):
            return self.get(credential_id)
        tenant_id = self._tenant().tenant_id
        with self._backend.lock(tenant_id, credential_id):
            row = self._row(credential_id)  # another worker may have refreshed while we waited
            if row["status"] == CredentialStatus.NEEDS_REAUTH.value:
                raise CredentialNeedsReauthError(credential_id)
            current = self._open(row)
            if not self._expiring(row, skew):
                return current
            try:
                new_secret, expires_at = refresh(current)
            except reauth_errors:
                self._set_status(row, CredentialStatus.NEEDS_REAUTH)
                raise
            self._write(credential_id, new_secret, connector_type=row["connector_type"],
                        display_name=row["display_name"], expires_at=expires_at, prev=row)
            return Secret(new_secret)

    def _set_status(self, row: Mapping[str, Any], status: CredentialStatus) -> None:
        new = {**row, "status": status.value, "version": row["version"] + 1,
               "updated_at": self._clock().isoformat()}
        self._backend.save(self._tenant().tenant_id, row["credential_id"], new, row["version"])

    def mark_needs_reauth(self, credential_id: str) -> None:
        self._set_status(self._row(credential_id), CredentialStatus.NEEDS_REAUTH)

    def meta(self, credential_id: str) -> CredentialMeta:
        return _meta(self._row(credential_id))

    def list(self) -> list[CredentialMeta]:
        return sorted((_meta(r) for r in self._backend.list(self._tenant().tenant_id)),
                      key=lambda m: m.credential_id)

    def delete(self, credential_id: str) -> None:
        self._backend.delete(self._tenant().tenant_id, credential_id)


class FileCredentialBackend:
    """Development/test backend: <root>/<tenant_id>/credentials.json holding sealed rows only."""

    def __init__(self, root: str | os.PathLike[str]) -> None:
        self.root = Path(root)
        self._guard = threading.Lock()
        self._locks: dict[tuple[str, str], threading.Lock] = {}

    def _path(self, tenant_id: str) -> Path:
        return self.root / validate_tenant_id(tenant_id) / "credentials.json"

    def _read(self, tenant_id: str) -> dict[str, dict[str, Any]]:
        p = self._path(tenant_id)
        return json.loads(p.read_text()) if p.exists() else {}

    def _write(self, tenant_id: str, rows: dict[str, dict[str, Any]]) -> None:
        p = self._path(tenant_id)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_name(p.name + ".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as fh:
            fh.write(json.dumps(rows, sort_keys=True))
        os.replace(tmp, p)

    def load(self, tenant_id: str, credential_id: str) -> dict[str, Any] | None:
        return self._read(tenant_id).get(credential_id)

    def save(self, tenant_id: str, credential_id: str, row: dict[str, Any], expected_version: int) -> None:
        with self._guard:
            rows = self._read(tenant_id)
            stored = rows.get(credential_id, {}).get("version", 0)
            if stored != expected_version:
                raise ConcurrentUpdateError(f"{credential_id}: expected v{expected_version}, found v{stored}")
            rows[credential_id] = row
            self._write(tenant_id, rows)

    def delete(self, tenant_id: str, credential_id: str) -> None:
        with self._guard:
            rows = self._read(tenant_id)
            if rows.pop(credential_id, None) is not None:
                self._write(tenant_id, rows)

    def list(self, tenant_id: str) -> list[dict[str, Any]]:
        return list(self._read(tenant_id).values())

    @contextmanager
    def lock(self, tenant_id: str, credential_id: str) -> Iterator[None]:
        with self._guard:
            lk = self._locks.setdefault((tenant_id, credential_id), threading.Lock())
        with lk:
            yield
