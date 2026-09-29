# Owner task: EB-21 Keycloak SSO, MFA and roles
"""Unit tests for Keycloak realm configuration and token verification with Admin MFA."""

from __future__ import annotations

import base64
import json
from pathlib import Path
import time
import pytest

from apps.api.auth.token_verifier import (
    AdminMfaRequiredError,
    InvalidClaimsError,
    KeycloakTokenVerifier,
    TokenError,
    TokenExpiredError,
)

ISSUER = "https://auth.klarity.internal/realms/klarity"
AUDIENCE = "klarity-api"


def _make_jwt(claims: dict[str, Any], header: dict[str, Any] | None = None) -> str:
    h = header or {"alg": "RS256", "typ": "JWT", "kid": "key-1"}
    h_b64 = base64.urlsafe_b64encode(json.dumps(h).encode("utf-8")).decode("ascii").rstrip("=")
    p_b64 = base64.urlsafe_b64encode(json.dumps(claims).encode("utf-8")).decode("ascii").rstrip("=")
    dummy_sig = base64.urlsafe_b64encode(b"dummy_signature_32_bytes_long!!").decode("ascii").rstrip("=")
    return f"{h_b64}.{p_b64}.{dummy_sig}"


def test_realm_json_structure() -> None:
    """Validate deploy/keycloak/realm.json configuration."""
    realm_path = Path(__file__).resolve().parents[3] / "deploy" / "keycloak" / "realm.json"
    assert realm_path.exists(), "realm.json must exist"

    doc = json.loads(realm_path.read_text(encoding="utf-8"))
    assert doc["realm"] == "klarity"
    assert doc["organizationsEnabled"] is True
    assert doc["defaultSignatureAlgorithm"] == "RS256"

    # Verify clients
    client_ids = {c["clientId"] for c in doc.get("clients", [])}
    assert "klarity-web" in client_ids
    assert "klarity-api" in client_ids

    # Verify organizations (ADR-013)
    orgs = {o["alias"] for o in doc.get("organizations", [])}
    assert "studio8" in orgs
    assert "synthetic-canary" in orgs

    # Verify Google IdP
    idps = {i["alias"] for i in doc.get("identityProviders", [])}
    assert "google" in idps

    # Verify roles
    role_names = {r["name"] for r in doc.get("roles", {}).get("realm", [])}
    expected_roles = {"owner", "admin", "member", "finance_viewer", "viewer", "guest"}
    assert expected_roles.issubset(role_names)


def test_valid_member_token_without_mfa() -> None:
    verifier = KeycloakTokenVerifier(issuer=ISSUER, audience=AUDIENCE)
    now = time.time()
    claims = {
        "iss": ISSUER,
        "aud": AUDIENCE,
        "sub": "user-456",
        "email": "lead@studio8.in",
        "roles": ["member"],
        "organization": ["studio8"],
        "tenant_id": "0fdc5142-8c25-41c5-aab4-0a88db52a5bf",
        "exp": now + 3600,
        "iat": now,
        "nbf": now - 10,
    }
    token = _make_jwt(claims)
    verified = verifier.verify(token, skip_sig_check=True)

    assert verified.sub == "user-456"
    assert verified.tenant_id == "0fdc5142-8c25-41c5-aab4-0a88db52a5bf"
    assert verified.organizations == ["studio8"]
    assert "member" in verified.roles
    assert not verified.is_admin
    assert not verified.is_finance_viewer


def test_admin_without_mfa_is_blocked() -> None:
    """Acceptance criterion: admin without MFA blocked."""
    verifier = KeycloakTokenVerifier(issuer=ISSUER, audience=AUDIENCE)
    now = time.time()
    claims = {
        "iss": ISSUER,
        "aud": AUDIENCE,
        "sub": "admin-1",
        "roles": ["admin"],
        "organization": ["studio8"],
        "exp": now + 3600,
        "iat": now,
    }
    token = _make_jwt(claims)

    with pytest.raises(AdminMfaRequiredError) as exc_info:
        verifier.verify(token, skip_sig_check=True)

    assert "must authenticate with multi-factor authentication" in str(exc_info.value)


def test_admin_with_mfa_succeeds() -> None:
    verifier = KeycloakTokenVerifier(issuer=ISSUER, audience=AUDIENCE)
    now = time.time()
    claims = {
        "iss": ISSUER,
        "aud": AUDIENCE,
        "sub": "admin-1",
        "roles": ["admin", "finance_viewer"],
        "organization": ["studio8"],
        "amr": ["pwd", "otp"],
        "exp": now + 3600,
        "iat": now,
    }
    token = _make_jwt(claims)
    verified = verifier.verify(token, skip_sig_check=True)

    assert verified.sub == "admin-1"
    assert verified.is_admin
    assert verified.is_finance_viewer


def test_expired_token_rejected() -> None:
    verifier = KeycloakTokenVerifier(issuer=ISSUER, audience=AUDIENCE)
    now = time.time()
    claims = {
        "iss": ISSUER,
        "aud": AUDIENCE,
        "sub": "u1",
        "exp": now - 3600,
        "iat": now - 7200,
    }
    token = _make_jwt(claims)
    with pytest.raises(TokenExpiredError):
        verifier.verify(token, skip_sig_check=True)


def test_audience_mismatch_rejected() -> None:
    verifier = KeycloakTokenVerifier(issuer=ISSUER, audience=AUDIENCE)
    now = time.time()
    claims = {
        "iss": ISSUER,
        "aud": "rogue-client",
        "sub": "u1",
        "exp": now + 3600,
        "iat": now,
    }
    token = _make_jwt(claims)
    with pytest.raises(InvalidClaimsError):
        verifier.verify(token, skip_sig_check=True)
