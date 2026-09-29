"""Raw payload storage: every fetched item is kept verbatim, content-addressed, under its tenant.

Owner task: EB-28 Connector SDK and source registry
Borrowed from: Onyx a18fc1a backend/onyx/connectors/interfaces.py (MIT) — `raw_file_callback`
(persist original bytes before processing). Adapted: content-addressed keys scoped by tenant and
source; reads verify the caller's tenant. The S3/MinIO implementation lands in packages/storage (EB-85);
LocalRawPayloadStore serves development and tests.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Protocol

from .errors import TenantMismatchError
from .models import validate_id

_REF_RE = re.compile(r"^raw://([^/]+)/([^/]+)/sha256:([0-9a-f]{64})$")


class RawPayloadStore(Protocol):
    def put(self, tenant_id: str, source_id: str, content_hash: str, payload: bytes, content_type: str) -> str:
        """Store bytes; return a raw_ref. Idempotent for identical content."""
        ...

    def get(self, tenant_id: str, raw_ref: str) -> bytes: ...


def make_raw_ref(tenant_id: str, source_id: str, content_hash: str) -> str:
    return f"raw://{validate_id('tenant_id', tenant_id)}/{validate_id('source_id', source_id)}/{content_hash}"


def parse_raw_ref(raw_ref: str) -> tuple[str, str, str]:
    m = _REF_RE.match(raw_ref)
    if not m:
        raise ValueError(f"invalid raw_ref: {raw_ref!r}")
    return m.group(1), m.group(2), m.group(3)


class LocalRawPayloadStore:
    def __init__(self, root: str | os.PathLike[str]) -> None:
        self.root = Path(root)

    def _path(self, tenant_id: str, source_id: str, hexdigest: str) -> Path:
        return self.root / tenant_id / source_id / hexdigest[:2] / hexdigest

    def put(self, tenant_id: str, source_id: str, content_hash: str, payload: bytes, content_type: str) -> str:
        ref = make_raw_ref(tenant_id, source_id, content_hash)
        _, _, hexdigest = parse_raw_ref(ref)
        path = self._path(tenant_id, source_id, hexdigest)
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp")
            tmp.write_bytes(payload)
            os.replace(tmp, path)
            path.with_suffix(".type").write_text(content_type)
        return ref

    def get(self, tenant_id: str, raw_ref: str) -> bytes:
        ref_tenant, source_id, hexdigest = parse_raw_ref(raw_ref)
        if ref_tenant != tenant_id:
            raise TenantMismatchError("raw_ref belongs to another tenant")
        return self._path(ref_tenant, source_id, hexdigest).read_bytes()
