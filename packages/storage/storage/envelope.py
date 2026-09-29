"""Per-tenant envelope encryption for secrets (Risk R-12).

Owner task: EB-85 Tenant registry and control plane
Borrowed from: Dify a4f949f api/libs/rsa.py (pattern only, no code) — one encryption key per tenant (D2).
Activepieces 611db01a server/api/src/app/helper/encryption.ts (MIT, A9) was read and not copied: it
encrypts every connection with one platform-wide key (ENCRYPTION_KEY) using unauthenticated AES-256-CBC,
so one leaked key exposes every tenant and a tampered ciphertext is not detected.

Scheme: each secret gets a fresh 256-bit data key (DEK) and is sealed with AES-256-GCM. The DEK is
wrapped by the tenant's key-encryption key (KEK), named by `placement.kms_key_ref`. The same encryption
context (tenant_id, record id, purpose) is bound into both the DEK wrap and the payload as associated
data, so a sealed value copied to another tenant or another record fails to open. Destroying a tenant's
KEK makes every one of its secrets unreadable, including in backups (crypto-shredding, OffboardTenant).

KeyProvider mirrors AWS KMS GenerateDataKey / Decrypt with EncryptionContext. The KMS provider needs a
client library (boto3) and waits on licence review; DevKeyring serves development and tests only.
"""

from __future__ import annotations

import base64
import json
import os
import secrets
import threading
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ALG = "AES-256-GCM"
ENVELOPE_VERSION = 1
_NONCE_BYTES = 12
_KEY_BYTES = 32


class EnvelopeError(Exception):
    pass


class KeyUnavailableError(EnvelopeError):
    """The tenant key does not exist or has been destroyed."""


class DecryptionError(EnvelopeError):
    """The value was tampered with, or belongs to another tenant or record."""


def context_bytes(context: Mapping[str, str]) -> bytes:
    if not context or not all(isinstance(k, str) and isinstance(v, str) for k, v in context.items()):
        raise ValueError("encryption context must be a non-empty str -> str mapping")
    return json.dumps(dict(context), sort_keys=True, separators=(",", ":")).encode()


class KeyProvider(Protocol):
    def generate_data_key(self, key_ref: str, context: Mapping[str, str]) -> tuple[bytes, bytes]:
        """Return (plaintext DEK, DEK wrapped under key_ref with context)."""
        ...

    def unwrap(self, key_ref: str, wrapped: bytes, context: Mapping[str, str]) -> bytes: ...


@dataclass(frozen=True)
class Envelope:
    key_ref: str
    wrapped_key: bytes
    nonce: bytes
    ciphertext: bytes
    alg: str = ALG
    version: int = ENVELOPE_VERSION

    def to_dict(self) -> dict[str, Any]:
        b64 = lambda b: base64.b64encode(b).decode()  # noqa: E731
        return {"v": self.version, "alg": self.alg, "key_ref": self.key_ref,
                "wrapped_key": b64(self.wrapped_key), "nonce": b64(self.nonce), "ciphertext": b64(self.ciphertext)}

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> Envelope:
        if d.get("v") != ENVELOPE_VERSION or d.get("alg") != ALG:
            raise DecryptionError(f"unsupported envelope {d.get('v')!r}/{d.get('alg')!r}")
        try:
            dec = base64.b64decode
            return cls(d["key_ref"], dec(d["wrapped_key"], validate=True), dec(d["nonce"], validate=True),
                       dec(d["ciphertext"], validate=True))
        except (KeyError, ValueError) as e:
            raise DecryptionError("malformed envelope") from e


def seal(keys: KeyProvider, key_ref: str, plaintext: bytes, context: Mapping[str, str]) -> Envelope:
    aad = context_bytes(context)
    dek, wrapped = keys.generate_data_key(key_ref, context)
    nonce = os.urandom(_NONCE_BYTES)
    return Envelope(key_ref, wrapped, nonce, AESGCM(dek).encrypt(nonce, plaintext, aad))


def open_envelope(keys: KeyProvider, env: Envelope, context: Mapping[str, str]) -> bytes:
    aad = context_bytes(context)
    dek = keys.unwrap(env.key_ref, env.wrapped_key, context)
    try:
        return AESGCM(dek).decrypt(env.nonce, env.ciphertext, aad)
    except InvalidTag:
        raise DecryptionError("secret failed authentication") from None


class DevKeyring:
    """Development/test KeyProvider: tenant KEKs in a local 0600 file. Never use in production —
    the KEKs sit on disk in the clear. Production uses KMS (keys never leave the HSM)."""

    def __init__(self, path: str | os.PathLike[str]) -> None:
        self.path = Path(path)
        self._lock = threading.Lock()

    def _read(self) -> dict[str, str]:
        return json.loads(self.path.read_text()) if self.path.exists() else {}

    def _write(self, keys: dict[str, str]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(self.path.name + ".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as fh:
            fh.write(json.dumps(keys, sort_keys=True))
        os.replace(tmp, self.path)

    def create_key(self, key_ref: str) -> None:
        """Called by ProvisionTenant. Idempotent: never replaces an existing key."""
        with self._lock:
            keys = self._read()
            if key_ref not in keys:
                keys[key_ref] = base64.b64encode(secrets.token_bytes(_KEY_BYTES)).decode()
                self._write(keys)

    def destroy_key(self, key_ref: str) -> None:
        """Crypto-shred: every secret wrapped under this key becomes unreadable."""
        with self._lock:
            keys = self._read()
            if keys.pop(key_ref, None) is not None:
                self._write(keys)

    def _kek(self, key_ref: str) -> AESGCM:
        b64 = self._read().get(key_ref)
        if b64 is None:
            raise KeyUnavailableError(f"no key {key_ref!r}")
        return AESGCM(base64.b64decode(b64))

    def generate_data_key(self, key_ref: str, context: Mapping[str, str]) -> tuple[bytes, bytes]:
        kek = self._kek(key_ref)
        dek = secrets.token_bytes(_KEY_BYTES)
        nonce = os.urandom(_NONCE_BYTES)
        return dek, nonce + kek.encrypt(nonce, dek, context_bytes(context))

    def unwrap(self, key_ref: str, wrapped: bytes, context: Mapping[str, str]) -> bytes:
        kek = self._kek(key_ref)
        try:
            return kek.decrypt(wrapped[:_NONCE_BYTES], wrapped[_NONCE_BYTES:], context_bytes(context))
        except InvalidTag:
            raise DecryptionError("data key failed authentication") from None


class KmsKeyProvider:
    """AWS KMS key provider for envelope encryption (Risk R-12).

    Mirrors AWS KMS GenerateDataKey and Decrypt with EncryptionContext.
    Accepts an existing boto3 KMS client, or creates one lazily.
    """

    def __init__(self, client: Any = None, *, region_name: str | None = None) -> None:
        self._client = client
        self._region_name = region_name

    def _get_client(self) -> Any:
        if self._client is None:
            try:
                import boto3  # noqa: PLC0415
            except ImportError as e:
                raise RuntimeError("boto3 is required for KmsKeyProvider when client is not passed") from e
            self._client = boto3.client("kms", region_name=self._region_name)
        return self._client

    def generate_data_key(self, key_ref: str, context: Mapping[str, str]) -> tuple[bytes, bytes]:
        ctx = dict(context)
        try:
            resp = self._get_client().generate_data_key(
                KeyId=key_ref,
                KeySpec="AES_256",
                EncryptionContext=ctx,
            )
            return resp["Plaintext"], resp["CiphertextBlob"]
        except Exception as e:
            err_code = getattr(e, "response", {}).get("Error", {}).get("Code", "")
            if err_code in ("NotFoundException", "DisabledException", "AccessDeniedException", "KeyUnavailableException") \
                    or "NotFoundException" in str(e) or "DisabledException" in str(e):
                raise KeyUnavailableError(f"KMS key {key_ref!r} unavailable: {e}") from e
            raise EnvelopeError(f"generate_data_key failed: {e}") from e

    def unwrap(self, key_ref: str, wrapped: bytes, context: Mapping[str, str]) -> bytes:
        ctx = dict(context)
        try:
            resp = self._get_client().decrypt(
                CiphertextBlob=wrapped,
                EncryptionContext=ctx,
                KeyId=key_ref,
            )
            return resp["Plaintext"]
        except Exception as e:
            err_code = getattr(e, "response", {}).get("Error", {}).get("Code", "")
            if err_code in ("NotFoundException", "DisabledException", "AccessDeniedException", "KeyUnavailableException") \
                    or "NotFoundException" in str(e) or "DisabledException" in str(e):
                raise KeyUnavailableError(f"KMS key {key_ref!r} unavailable: {e}") from e
            if err_code in ("InvalidCiphertextException", "IncorrectKeyException") \
                    or "InvalidCiphertextException" in str(e) or "IncorrectKeyException" in str(e):
                raise DecryptionError(f"KMS decryption failed: {e}") from e
            raise DecryptionError(f"KMS decryption failed: {e}") from e
