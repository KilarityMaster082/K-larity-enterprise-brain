"""Owner task: EB-85 Tenant registry and control plane — tenant-scoped object store tests."""

from __future__ import annotations

from typing import Any

import pytest

from storage import LocalObjectBackend, ObjectStore
from tenant_context import NoTenantContextError, tenant_scope


@pytest.fixture
def store(tmp_path):
    return ObjectStore(LocalObjectBackend(tmp_path)), tmp_path


def test_keys_land_under_the_tenant_prefix(store, ctx):
    s, root = store
    with tenant_scope(ctx("tenant-a")):
        s.put("raw/doc.txt", b"hello")
        assert s.get("raw/doc.txt") == b"hello" and s.exists("raw/doc.txt")
        assert s.list() == ["raw/doc.txt"] and s.list("raw/") == ["raw/doc.txt"]
    assert (root / "bkt/tenants/tenant-a/raw/doc.txt").read_bytes() == b"hello"


def test_same_key_is_isolated_per_tenant(store, ctx):
    s, _ = store
    with tenant_scope(ctx("tenant-a")):
        s.put("k", b"a")
    with tenant_scope(ctx("tenant-b")):
        assert not s.exists("k") and s.list() == []
        s.put("k", b"b")
    with tenant_scope(ctx("tenant-a")):
        assert s.get("k") == b"a"
        s.delete("k")
        assert not s.exists("k")
    with tenant_scope(ctx("tenant-b")):
        assert s.get("k") == b"b"


@pytest.mark.parametrize("key", ["", "/abs", "../tenant-b/k", "a/../../tenant-b/k", "a//b", "a/./b", "a\\b"])
def test_traversal_and_malformed_keys_are_rejected(store, ctx, key):
    s, _ = store
    with tenant_scope(ctx("tenant-a")):
        with pytest.raises(ValueError):
            s.put(key, b"x")


def test_list_prefix_cannot_climb_out(store, ctx):
    s, _ = store
    with tenant_scope(ctx("tenant-a")):
        with pytest.raises(ValueError):
            s.list("../")


def test_every_call_needs_a_context(store, ctx):
    s, _ = store
    for call in (lambda: s.put("k", b"x"), lambda: s.get("k"), lambda: s.exists("k"),
                 lambda: s.delete("k"), s.list):
        with pytest.raises(NoTenantContextError):
            call()


class MockS3Client:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}

    def put_object(self, Bucket: str, Key: str, Body: bytes, ContentType: str = "application/octet-stream") -> None:
        self.objects[(Bucket, Key)] = Body

    def get_object(self, Bucket: str, Key: str) -> dict[str, Any]:
        if (Bucket, Key) not in self.objects:
            raise Exception("NoSuchKey (404)")
        return {"Body": self.objects[(Bucket, Key)]}

    def head_object(self, Bucket: str, Key: str) -> dict[str, Any]:
        if (Bucket, Key) not in self.objects:
            raise Exception("NoSuchKey (404)")
        return {}

    def delete_object(self, Bucket: str, Key: str) -> None:
        self.objects.pop((Bucket, Key), None)

    def list_objects_v2(self, Bucket: str, Prefix: str = "") -> dict[str, Any]:
        contents = [{"Key": k} for (b, k) in self.objects if b == Bucket and k.startswith(Prefix)]
        return {"Contents": contents}


def test_s3_object_backend_with_mock_client(ctx):
    from storage import S3ObjectBackend
    mock = MockS3Client()
    s3_backend = S3ObjectBackend(client=mock)
    store = ObjectStore(s3_backend)

    with tenant_scope(ctx("tenant-a")):
        store.put("raw/file.csv", b"col1,col2\n1,2")
        assert store.exists("raw/file.csv")
        assert store.get("raw/file.csv") == b"col1,col2\n1,2"
        assert store.list("raw/") == ["raw/file.csv"]
        store.delete("raw/file.csv")
        assert not store.exists("raw/file.csv")
        assert store.list("raw/") == []
