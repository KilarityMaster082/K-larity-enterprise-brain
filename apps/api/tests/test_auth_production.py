# Owner task: EB-21 Keycloak SSO, MFA and roles · EB-20 tenant middleware
"""Production auth is fail-closed: the tenant and user come from a signature-verified token, never from headers."""

from __future__ import annotations

import asyncio
import base64
import json
import time
from typing import Any

import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from apps.api.auth.token_verifier import KeycloakTokenVerifier, TokenError
from apps.api.main import create_app
from apps.api.middleware.tenant import TenantMiddleware
from apps.api.tests.test_ask_api import call_api
from control_plane import FileTenantRegistry
from control_plane.seed import STUDIO8_ID, SYNTHETIC_ID, seed
from tenant_context import PlacementResolver, current_tenant

ISSUER = "https://auth.klarity.internal/realms/klarity"
AUDIENCE = "klarity-api"


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _int_b64(n: int) -> str:
    return _b64(n.to_bytes((n.bit_length() + 7) // 8, "big"))


class Issuer:
    """A throwaway Keycloak: an RSA key, its JWK, and a token signer."""

    def __init__(self, kid: str = "k1") -> None:
        self.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        nums = self.key.public_key().public_numbers()
        self.jwk = {"kty": "RSA", "kid": kid, "alg": "RS256", "n": _int_b64(nums.n), "e": _int_b64(nums.e)}
        self.kid = kid

    def token(self, **claims: Any) -> str:
        now = time.time()
        body = {"iss": ISSUER, "aud": AUDIENCE, "sub": "user-1", "roles": ["member"], "tenant_id": STUDIO8_ID,
                "exp": now + 600, "iat": now, **claims}
        head = _b64(json.dumps({"alg": "RS256", "typ": "JWT", "kid": self.kid}).encode())
        payload = _b64(json.dumps(body).encode())
        sig = self.key.sign(f"{head}.{payload}".encode(), padding.PKCS1v15(), hashes.SHA256())
        return f"{head}.{payload}.{_b64(sig)}"


@pytest.fixture
def resolver(tmp_path: Any) -> PlacementResolver:
    reg = FileTenantRegistry(tmp_path / "control.json")
    seed(reg, activate=True)
    return PlacementResolver(reg, ttl_seconds=60)


@pytest.fixture
def idp() -> Issuer:
    return Issuer()


@pytest.fixture
def app(resolver, idp):
    return create_app(resolver, verifier=KeycloakTokenVerifier(ISSUER, AUDIENCE, cached_keys={idp.kid: idp.jwk}))


def bearer(t: str, **extra: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {t}", **extra}


def test_valid_signed_token_selects_its_tenant(app, idp) -> None:
    status, res = asyncio.run(call_api(app, "GET", "/api/v1/tenant/current", headers=bearer(idp.token())))
    assert status == 200 and res["tenant_id"] == STUDIO8_ID


def test_default_mode_is_production_header_alone_is_refused(resolver, idp) -> None:
    app = create_app(resolver, verifier=KeycloakTokenVerifier(ISSUER, AUDIENCE, cached_keys={idp.kid: idp.jwk}))
    status, res = asyncio.run(call_api(app, "GET", "/api/v1/tenant/current", headers={"X-Tenant-ID": STUDIO8_ID}))
    assert status == 401 and res["error"] == "missing_tenant"


def test_forged_token_signed_with_another_key_is_rejected(app) -> None:
    attacker = Issuer()
    status, res = asyncio.run(call_api(app, "GET", "/api/v1/tenant/current", headers=bearer(attacker.token())))
    assert status == 401 and res["error"] == "invalid_token"


def test_unsigned_and_tampered_tokens_are_rejected(app, idp) -> None:
    good = idp.token()
    head, payload, sig = good.split(".")
    other = _b64(json.dumps({**json.loads(base64.urlsafe_b64decode(payload + "==")), "tenant_id": SYNTHETIC_ID}).encode())
    for forged in (f"{head}.{payload}.", f"{head}.{other}.{sig}", f"{head}.{payload}.{_b64(b'x' * 256)}"):
        status, res = asyncio.run(call_api(app, "GET", "/api/v1/tenant/current", headers=bearer(forged)))
        assert status == 401, forged


def test_header_cannot_override_the_tenant_in_the_token(app, idp) -> None:
    status, res = asyncio.run(call_api(app, "GET", "/api/v1/tenant/current",
                                       headers=bearer(idp.token(), **{"X-Tenant-ID": SYNTHETIC_ID})))
    assert status == 403 and res["error"] == "tenant_access_denied"


def test_multi_tenant_token_must_select_one_it_holds(app, idp) -> None:
    t = idp.token(organization=[STUDIO8_ID, SYNTHETIC_ID])
    status, res = asyncio.run(call_api(app, "GET", "/api/v1/tenant/current", headers=bearer(t)))
    assert status == 400 and res["error"] == "invalid_tenant"
    status, res = asyncio.run(call_api(app, "GET", "/api/v1/tenant/current", headers=bearer(t, **{"X-Tenant-ID": SYNTHETIC_ID})))
    assert status == 200 and res["tenant_id"] == SYNTHETIC_ID


def test_no_verifier_configured_fails_closed(resolver, idp) -> None:
    status, res = asyncio.run(call_api(create_app(resolver), "GET", "/api/v1/tenant/current", headers=bearer(idp.token())))
    assert status == 503 and res["error"] == "auth_not_configured"


def test_verifier_without_keys_never_skips_the_signature_check(idp) -> None:
    with pytest.raises(TokenError):
        KeycloakTokenVerifier(ISSUER, AUDIENCE).verify(idp.token())  # no keys loaded → refuse, not accept


def test_verified_user_reaches_the_handler_and_dev_headers_are_ignored_in_production(resolver, idp) -> None:
    seen: dict[str, Any] = {}

    async def inner(scope, receive, send):
        seen["user"] = scope["state"]["user"]
        seen["tenant"] = current_tenant().tenant_id
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    mw = TenantMiddleware(inner, resolver, verifier=KeycloakTokenVerifier(ISSUER, AUDIENCE, cached_keys={idp.kid: idp.jwk}),
                          auth_mode="production")
    status, _ = asyncio.run(call_api(mw, "GET", "/x", headers=bearer(idp.token(sub="asha", roles=["member"]),
                                                                       **{"X-User-ID": "root", "X-User-Roles": "owner"})))
    assert status == 204
    assert seen["user"].user_id == "asha" and seen["user"].roles == ("member",) and seen["user"].verified is True


def test_development_mode_is_refused_in_production_env(resolver, monkeypatch) -> None:
    monkeypatch.setenv("KLARITY_ENV", "production")
    with pytest.raises(RuntimeError):
        create_app(resolver, auth_mode="development")
    monkeypatch.setenv("KLARITY_AUTH_MODE", "bogus")
    with pytest.raises(ValueError):
        create_app(resolver)


def test_development_mode_reads_headers_and_marks_user_unverified(resolver) -> None:
    seen: dict[str, Any] = {}

    async def inner(scope, receive, send):
        seen["user"] = scope["state"]["user"]
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    mw = TenantMiddleware(inner, resolver, auth_mode="development")
    asyncio.run(call_api(mw, "GET", "/x", headers={"X-Tenant-ID": STUDIO8_ID, "X-User-ID": "dev-user"}))
    assert seen["user"].user_id == "dev-user" and seen["user"].verified is False
