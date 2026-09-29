"""Owner task: EB-85 Tenant registry and control plane — envelope encryption and credential store tests
(Risk R-12: no plaintext secret at rest or in logs; per-tenant keys; crypto-shredding)."""

from __future__ import annotations

import json
import pickle
import stat
import threading
import time
from datetime import datetime, timedelta, timezone

import pytest

from storage import (
    ConcurrentUpdateError,
    CredentialError,
    CredentialNeedsReauthError,
    CredentialNotFoundError,
    CredentialStatus,
    CredentialStore,
    DecryptionError,
    DevKeyring,
    Envelope,
    FileCredentialBackend,
    KeyUnavailableError,
    Secret,
)
from storage.envelope import open_envelope, seal
from tenant_context import NoTenantContextError, tenant_scope

CANARY = "ya29.CANARY-refresh-token-7f3e"
T0 = datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc)


class Clock:
    def __init__(self) -> None:
        self.now = T0

    def __call__(self) -> datetime:
        return self.now


class AuthRevoked(Exception):
    pass


@pytest.fixture
def env(tmp_path, ctx):
    keys = DevKeyring(tmp_path / "keyring.json")
    for t in ("tenant-a", "tenant-b"):
        keys.create_key(ctx(t).placement.kms_key_ref)
    backend = FileCredentialBackend(tmp_path / "creds")
    clock = Clock()
    return CredentialStore(backend, keys, clock=clock), backend, keys, clock, tmp_path


def _put(store, cid="gmail-1", secret=None, expires_at=None):
    return store.put(cid, secret or {"refresh_token": CANARY, "access_token": "at-1"},
                     connector_type="gmail", display_name="Studio 8 Gmail", expires_at=expires_at)


# -- basics ------------------------------------------------------------------------------------------------
def test_round_trip_and_metadata(env, ctx):
    store, *_ = env
    with tenant_scope(ctx("tenant-a")):
        m1 = _put(store)
        assert store.get("gmail-1")["refresh_token"] == CANARY
        m2 = _put(store, secret={"refresh_token": "rt-2"})
        assert (m1.version, m2.version, m2.created_at) == (1, 2, m1.created_at)
        assert store.get("gmail-1") == {"refresh_token": "rt-2"}
        assert [m.credential_id for m in store.list()] == ["gmail-1"]
        assert CANARY not in repr(store.meta("gmail-1"))
        store.delete("gmail-1")
        with pytest.raises(CredentialNotFoundError):
            store.get("gmail-1")


def test_nothing_plaintext_at_rest_and_files_are_private(env, ctx):
    store, _, _, _, root = env
    with tenant_scope(ctx("tenant-a")):
        _put(store)
    for f in (root / "creds").rglob("*.json"):
        assert CANARY.encode() not in f.read_bytes()
        assert stat.S_IMODE(f.stat().st_mode) == 0o600
    assert stat.S_IMODE((root / "keyring.json").stat().st_mode) == 0o600


def test_secret_cannot_leak_through_logs_pickle_or_json(env, ctx):
    store, *_ = env
    with tenant_scope(ctx("tenant-a")):
        _put(store)
        s = store.get("gmail-1")
    for text in (repr(s), str(s), f"{s}", f"{s!r}", str(RuntimeError(s)), str([s])):
        assert CANARY not in text
    with pytest.raises(TypeError):
        pickle.dumps(s)
    with pytest.raises(TypeError):
        json.dumps(s)
    with pytest.raises(AttributeError):
        s._data = {}


def test_every_call_needs_a_context(env):
    store, *_ = env
    for call in (lambda: _put(store), lambda: store.get("gmail-1"), store.list, lambda: store.meta("gmail-1"),
                 lambda: store.delete("gmail-1"), lambda: store.mark_needs_reauth("gmail-1"),
                 lambda: store.get_fresh("gmail-1", lambda s: ({}, None))):
        with pytest.raises(NoTenantContextError):
            call()


@pytest.mark.parametrize("cid", ["", "Gmail", "../x", "a/b", "a" * 64])
def test_credential_id_shape(env, ctx, cid):
    store, *_ = env
    with tenant_scope(ctx("tenant-a")):
        with pytest.raises(ValueError):
            _put(store, cid)


# -- isolation and tampering -------------------------------------------------------------------------------
def test_other_tenant_cannot_see_or_open_the_credential(env, ctx, tmp_path):
    store, backend, *_ = env
    with tenant_scope(ctx("tenant-a")):
        _put(store)
        row = backend.load("tenant-a", "gmail-1")
    with tenant_scope(ctx("tenant-b")):
        assert store.list() == []
        with pytest.raises(CredentialNotFoundError):
            store.get("gmail-1")
        backend.save("tenant-b", "gmail-1", row, 0)  # a row copied across tenants (e.g. a bad restore)
        with pytest.raises(CredentialError, match="does not belong to this tenant"):
            store.get("gmail-1")


def test_sealed_value_is_bound_to_tenant_and_record(env, ctx):
    _, _, keys, _, _ = env
    ref = ctx("tenant-a").placement.kms_key_ref
    good = {"purpose": "connector-credential", "tenant_id": "tenant-a", "credential_id": "gmail-1"}
    e = seal(keys, ref, b"secret", good)
    assert open_envelope(keys, e, good) == b"secret"
    for bad in ({**good, "tenant_id": "tenant-b"}, {**good, "credential_id": "gmail-2"}):
        with pytest.raises(DecryptionError):
            open_envelope(keys, e, bad)


def test_wrapped_data_key_is_bound_to_context(env, ctx):
    """The key service half of the binding (KMS enforces the same with EncryptionContext)."""
    _, _, keys, _, _ = env
    ref = ctx("tenant-a").placement.kms_key_ref
    good = {"purpose": "connector-credential", "tenant_id": "tenant-a", "credential_id": "gmail-1"}
    dek, wrapped = keys.generate_data_key(ref, good)
    assert keys.unwrap(ref, wrapped, good) == dek
    with pytest.raises(DecryptionError):
        keys.unwrap(ref, wrapped, {**good, "tenant_id": "tenant-b"})
    with pytest.raises(KeyUnavailableError):
        keys.unwrap(ctx("tenant-z").placement.kms_key_ref, wrapped, good)


def test_payload_is_bound_even_if_the_key_service_ignores_context():
    """Defence in depth: the payload's own associated data catches a swap, not only the DEK wrap."""

    class LooseKeys:  # a KeyProvider that does not bind the context to the wrapped key
        dek = b"k" * 32

        def generate_data_key(self, key_ref, context):
            return self.dek, b"wrapped"

        def unwrap(self, key_ref, wrapped, context):
            return self.dek

    good = {"purpose": "connector-credential", "tenant_id": "tenant-a", "credential_id": "gmail-1"}
    e = seal(LooseKeys(), "ref", b"secret", good)
    with pytest.raises(DecryptionError):
        open_envelope(LooseKeys(), e, {**good, "tenant_id": "tenant-b"})


def test_row_swapped_between_credentials_fails(env, ctx):
    store, backend, *_ = env
    with tenant_scope(ctx("tenant-a")):
        _put(store, "gmail-1")
        _put(store, "gmail-2", secret={"refresh_token": "other"})
        row1 = backend.load("tenant-a", "gmail-1")
        backend.save("tenant-a", "gmail-2", {**row1, "credential_id": "gmail-2"}, 1)
        with pytest.raises(DecryptionError):
            store.get("gmail-2")


@pytest.mark.parametrize("field", ["ciphertext", "wrapped_key", "nonce"])
def test_tampering_is_detected(env, ctx, field):
    store, backend, *_ = env
    with tenant_scope(ctx("tenant-a")):
        _put(store)
        row = backend.load("tenant-a", "gmail-1")
        e = Envelope.from_dict(row["envelope"])
        raw = bytearray(getattr(e, field))
        raw[-1] ^= 0x01
        forged = Envelope(**{**e.__dict__, field: bytes(raw)}).to_dict()
        backend.save("tenant-a", "gmail-1", {**row, "envelope": forged, "version": 2}, 1)
        with pytest.raises(DecryptionError):
            store.get("gmail-1")


def test_unsupported_envelope_is_refused():
    with pytest.raises(DecryptionError):
        Envelope.from_dict({"v": 1, "alg": "AES-256-CBC", "key_ref": "k", "wrapped_key": "", "nonce": "",
                            "ciphertext": ""})


# -- keys --------------------------------------------------------------------------------------------------
def test_destroying_the_tenant_key_shreds_its_credentials_only(env, ctx):
    store, _, keys, _, _ = env
    for t in ("tenant-a", "tenant-b"):
        with tenant_scope(ctx(t)):
            _put(store)
    keys.destroy_key(ctx("tenant-a").placement.kms_key_ref)
    with tenant_scope(ctx("tenant-a")):
        with pytest.raises(KeyUnavailableError):
            store.get("gmail-1")
    with tenant_scope(ctx("tenant-b")):
        assert store.get("gmail-1")["refresh_token"] == CANARY


def test_no_key_is_created_implicitly(tmp_path, ctx):
    store = CredentialStore(FileCredentialBackend(tmp_path / "c"), DevKeyring(tmp_path / "k.json"))
    with tenant_scope(ctx("tenant-a")):
        with pytest.raises(KeyUnavailableError):
            _put(store)


def test_create_key_never_replaces_an_existing_key(env, ctx):
    store, _, keys, _, _ = env
    with tenant_scope(ctx("tenant-a")):
        _put(store)
        keys.create_key(ctx("tenant-a").placement.kms_key_ref)
        assert store.get("gmail-1")["refresh_token"] == CANARY


# -- refresh (A9: lock, re-check, mark on auth error) -------------------------------------------------------
def test_no_refresh_until_within_skew(env, ctx):
    store, _, _, clock, _ = env
    calls = []
    with tenant_scope(ctx("tenant-a")):
        _put(store, expires_at=T0 + timedelta(hours=1))
        refresh = lambda s: (calls.append(1) or ({"access_token": "at-2"}, T0 + timedelta(hours=2)))  # noqa: E731
        assert store.get_fresh("gmail-1", refresh)["access_token"] == "at-1"
        clock.now = T0 + timedelta(minutes=46)
        assert store.get_fresh("gmail-1", refresh)["access_token"] == "at-2"
        assert calls == [1] and store.meta("gmail-1").version == 2
        assert store.get_fresh("gmail-1", refresh)["access_token"] == "at-2"  # fresh again: no call
        assert calls == [1]


def test_concurrent_workers_refresh_once(env, ctx):
    store, _, _, clock, _ = env
    with tenant_scope(ctx("tenant-a")):
        _put(store, expires_at=T0)  # already expired
    calls, results = [], []

    def refresh(s: Secret):
        calls.append(1)
        time.sleep(0.05)
        return {"access_token": "at-new"}, T0 + timedelta(hours=1)

    def worker():
        with tenant_scope(ctx("tenant-a")):
            results.append(store.get_fresh("gmail-1", refresh)["access_token"])

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(calls) == 1 and results == ["at-new"] * 8


def test_auth_error_marks_needs_reauth_and_stops_retries(env, ctx):
    store, *_ = env
    calls = []

    def revoked(s):
        calls.append(1)
        raise AuthRevoked("invalid_grant")

    with tenant_scope(ctx("tenant-a")):
        _put(store, expires_at=T0)
        with pytest.raises(AuthRevoked):
            store.get_fresh("gmail-1", revoked, reauth_errors=(AuthRevoked,))
        assert store.meta("gmail-1").status is CredentialStatus.NEEDS_REAUTH
        for call in (lambda: store.get("gmail-1"),
                     lambda: store.get_fresh("gmail-1", revoked, reauth_errors=(AuthRevoked,))):
            with pytest.raises(CredentialNeedsReauthError):
                call()
        assert calls == [1]
        _put(store, expires_at=T0 + timedelta(hours=1))  # tenant re-authorises
        assert store.meta("gmail-1").status is CredentialStatus.ACTIVE


def test_transient_refresh_error_leaves_credential_active(env, ctx):
    store, *_ = env

    def flaky(s):
        raise TimeoutError("token endpoint timed out")

    with tenant_scope(ctx("tenant-a")):
        _put(store, expires_at=T0)
        with pytest.raises(TimeoutError):
            store.get_fresh("gmail-1", flaky, reauth_errors=(AuthRevoked,))
        assert store.meta("gmail-1").status is CredentialStatus.ACTIVE


def test_stale_write_is_rejected(env, ctx):
    store, backend, *_ = env
    with tenant_scope(ctx("tenant-a")):
        _put(store)
        row = backend.load("tenant-a", "gmail-1")
        _put(store, secret={"refresh_token": "newer"})
        with pytest.raises(ConcurrentUpdateError):
            backend.save("tenant-a", "gmail-1", row, row["version"])
