"""Tenant-scoped object storage. Bucket and prefix come from the active TenantContext, never from callers.

Owner task: EB-85 Tenant registry and control plane
Callers pass keys relative to their tenant ("raw/src-1/ab/abcd..."); the store prepends the placement's
`tenants/<tenant_id>/` prefix inside the placement's bucket, so no call can name another tenant's
objects. Keys are checked for traversal. LocalObjectBackend serves development and tests; the S3 backend
(SeaweedFS or managed S3 in India, foundation-fit §4.3) needs a client library and waits on licence review.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path
from typing import Protocol

from tenant_context import TenantScopedStore


class ObjectBackend(Protocol):
    def put(self, bucket: str, key: str, data: bytes, content_type: str) -> None: ...
    def get(self, bucket: str, key: str) -> bytes: ...
    def exists(self, bucket: str, key: str) -> bool: ...
    def delete(self, bucket: str, key: str) -> None: ...
    def list(self, bucket: str, prefix: str) -> Iterator[str]: ...


def check_key(key: str) -> str:
    parts = key.split("/")
    if (not key or key.startswith("/") or "\\" in key or "\x00" in key
            or any(p in ("", ".", "..") for p in parts)):
        raise ValueError(f"invalid object key: {key!r}")
    return key


class ObjectStore(TenantScopedStore):
    def __init__(self, backend: ObjectBackend) -> None:
        self._backend = backend

    def _loc(self, key: str) -> tuple[str, str]:
        p = self._placement()
        return p.object_bucket, p.object_prefix + check_key(key)

    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        self._backend.put(*self._loc(key), data, content_type)

    def get(self, key: str) -> bytes:
        return self._backend.get(*self._loc(key))

    def exists(self, key: str) -> bool:
        return self._backend.exists(*self._loc(key))

    def delete(self, key: str) -> None:
        self._backend.delete(*self._loc(key))

    def list(self, prefix: str = "") -> list[str]:
        """Keys under `prefix`, relative to the tenant (the tenant prefix is stripped)."""
        p = self._placement()
        if prefix:
            check_key(prefix.rstrip("/"))
        full = p.object_prefix + prefix
        return sorted(k[len(p.object_prefix):] for k in self._backend.list(p.object_bucket, full))


class LocalObjectBackend:
    """Filesystem backend: <root>/<bucket>/<key>. Writes are atomic."""

    def __init__(self, root: str | os.PathLike[str]) -> None:
        self.root = Path(root).resolve()

    def _path(self, bucket: str, key: str) -> Path:
        path = (self.root / bucket / key).resolve()
        if not path.is_relative_to(self.root / bucket):
            raise ValueError(f"key escapes bucket: {key!r}")
        return path

    def put(self, bucket: str, key: str, data: bytes, content_type: str) -> None:  # noqa: ARG002
        path = self._path(bucket, key)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_bytes(data)
        os.replace(tmp, path)

    def get(self, bucket: str, key: str) -> bytes:
        return self._path(bucket, key).read_bytes()

    def exists(self, bucket: str, key: str) -> bool:
        return self._path(bucket, key).is_file()

    def delete(self, bucket: str, key: str) -> None:
        self._path(bucket, key).unlink(missing_ok=True)

    def list(self, bucket: str, prefix: str) -> Iterator[str]:
        base = self.root / bucket
        if not base.exists():
            return
        for f in base.rglob("*"):
            if f.is_file() and not f.name.endswith(".tmp"):
                key = f.relative_to(base).as_posix()
                if key.startswith(prefix):
                    yield key
