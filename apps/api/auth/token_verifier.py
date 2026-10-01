# Owner task: EB-21 Keycloak SSO, MFA and roles
"""Keycloak RS256 token verification and admin MFA policy enforcement.

Aligns with Keycloak Organizations (KC 26+) and apps/web/lib/auth/jwt.ts:
- Validates RS256 signatures against JWKS.
- Verifies issuer, audience, and expiration boundaries.
- Resolves tenant_id from `tenant_id` or `organization` claims.
- Enforces Admin MFA: Admins/Owners without MFA assurance (amr/acr) are blocked (Risk R-13).
"""

from __future__ import annotations

import base64
import json
import time
from dataclasses import dataclass
from typing import Any, Sequence
from urllib.request import Request, urlopen


class TokenError(Exception):
    """Base error for JWT validation failures."""


class TokenExpiredError(TokenError):
    pass


class InvalidClaimsError(TokenError):
    pass


class AdminMfaRequiredError(TokenError):
    """Raised when an administrative or owner role attempts login without MFA assurance."""


@dataclass(frozen=True)
class VerifiedToken:
    sub: str
    tenant_id: str | None
    organizations: list[str]
    roles: list[str]
    email: str | None
    name: str | None
    claims: dict[str, Any]

    @property
    def is_admin(self) -> bool:
        return "admin" in self.roles or "owner" in self.roles

    @property
    def is_finance_viewer(self) -> bool:
        return "finance_viewer" in self.roles or "owner" in self.roles


def _b64url_decode(payload: str) -> bytes:
    rem = len(payload) % 4
    if rem > 0:
        payload += "=" * (4 - rem)
    return base64.urlsafe_b64decode(payload.encode("ascii"))


def _verify_rs256(jwk: dict[str, Any], signed_data: bytes, signature: bytes) -> None:
    """RSASSA-PKCS1-v1_5 / SHA-256 verification straight from a JWK (no PyJWT dependency, no silent skip)."""
    try:
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import padding, rsa
    except ImportError as e:  # pragma: no cover - cryptography is a pinned CI dependency
        raise TokenError("cryptography is required to verify token signatures") from e
    if jwk.get("kty") != "RSA" or "n" not in jwk or "e" not in jwk:
        raise TokenError("Signing key is not a usable RSA JWK")
    try:
        n = int.from_bytes(_b64url_decode(jwk["n"]), "big")
        exp = int.from_bytes(_b64url_decode(jwk["e"]), "big")
        public_key = rsa.RSAPublicNumbers(exp, n).public_key()
        public_key.verify(signature, signed_data, padding.PKCS1v15(), hashes.SHA256())
    except Exception as e:
        raise TokenError(f"Invalid signature: {e}") from e


class KeycloakTokenVerifier:
    """Verifies Keycloak JWT tokens against JSON Web Key Sets (JWKS)."""

    def __init__(
        self,
        issuer: str,
        audience: str,
        jwks_url: str | None = None,
        cached_keys: dict[str, Any] | None = None,
        require_admin_mfa: bool = True,
        skew_seconds: int = 60,
    ) -> None:
        self.issuer = issuer.rstrip("/")
        self.audience = audience
        self.jwks_url = jwks_url
        self._keys: dict[str, Any] = cached_keys or {}
        self.require_admin_mfa = require_admin_mfa
        self.skew_seconds = skew_seconds

    def load_jwks(self) -> dict[str, Any]:
        """Fetch remote JWKS or return locally cached keys."""
        if not self.jwks_url:
            return self._keys
        try:
            req = Request(self.jwks_url, headers={"Accept": "application/json"})
            with urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                for key in data.get("keys", []):
                    kid = key.get("kid")
                    if kid:
                        self._keys[kid] = key
        except Exception as e:
            if not self._keys:
                raise TokenError(f"Failed to load JWKS from {self.jwks_url}: {e}") from e
        return self._keys

    def verify(
        self,
        token: str,
        *,
        skip_sig_check: bool = False,
        now: float | None = None,
    ) -> VerifiedToken:
        """Parse and verify Keycloak JWT.

        In local test mode, skip_sig_check=True can be used if public keys
        are not loaded from an active Keycloak instance.
        """
        parts = token.split(".")
        if len(parts) != 3:
            raise TokenError("Malformed token: JWT must contain 3 segments")

        header_raw, payload_raw, sig_raw = parts

        try:
            header = json.loads(_b64url_decode(header_raw).decode("utf-8"))
            claims = json.loads(_b64url_decode(payload_raw).decode("utf-8"))
        except Exception as e:
            raise TokenError(f"Malformed token JSON: {e}") from e

        # 1. Header validations
        if header.get("alg") != "RS256":
            raise TokenError(f"Unsupported token algorithm: {header.get('alg')}; only RS256 allowed")

        # 2. Signature verification — fail closed. An unsigned or unverifiable token is never accepted: with no
        # signing keys loaded, or no crypto library, verification fails instead of being skipped.
        if not skip_sig_check:
            if not self._keys:
                self.load_jwks()
            if not self._keys:
                raise TokenError("No signing keys configured; refusing to accept an unverified token")
            kid = header.get("kid")
            jwk = self._keys.get(kid) if kid else (next(iter(self._keys.values())) if len(self._keys) == 1 else None)
            if not jwk:
                raise TokenError(f"Key ID {kid!r} not found in JWKS")
            _verify_rs256(jwk, f"{header_raw}.{payload_raw}".encode("ascii"), _b64url_decode(sig_raw))

        # 3. Claims validations
        current_time = now if now is not None else time.time()

        exp = claims.get("exp")
        if exp is None or not isinstance(exp, (int, float)):
            raise InvalidClaimsError("Missing or invalid 'exp' claim")
        if exp + self.skew_seconds < current_time:
            raise TokenExpiredError("Token has expired")

        nbf = claims.get("nbf")
        if nbf is not None and isinstance(nbf, (int, float)):
            if nbf - self.skew_seconds > current_time:
                raise InvalidClaimsError("Token is not valid yet (nbf in future)")

        iss = str(claims.get("iss", "")).rstrip("/")
        if iss != self.issuer:
            raise InvalidClaimsError(f"Issuer mismatch: expected {self.issuer!r}, got {iss!r}")

        aud = claims.get("aud")
        aud_list = [aud] if isinstance(aud, str) else (aud if isinstance(aud, list) else [])
        azp = claims.get("azp")
        if self.audience not in aud_list and azp != self.audience:
            raise InvalidClaimsError(f"Audience mismatch: expected {self.audience!r}")

        sub = claims.get("sub")
        if not sub or not isinstance(sub, str):
            raise InvalidClaimsError("Missing 'sub' claim")

        # 4. Extract roles
        roles: list[str] = []
        if isinstance(claims.get("roles"), list):
            roles.extend(str(r) for r in claims["roles"])
        if isinstance(claims.get("realm_access"), dict) and isinstance(claims["realm_access"].get("roles"), list):
            roles.extend(str(r) for r in claims["realm_access"]["roles"])
        roles = list(dict.fromkeys(roles))

        # 5. Extract organization / tenant_id
        organizations: list[str] = []
        raw_org = claims.get("organization")
        if isinstance(raw_org, list):
            organizations = [str(o) for o in raw_org]
        elif isinstance(raw_org, dict):
            organizations = list(raw_org.keys())
        elif isinstance(raw_org, str):
            organizations = [raw_org]

        tenant_id = claims.get("tenant_id")
        if not tenant_id and organizations:
            # Fall back to first organization alias if tenant_id attribute not explicit
            tenant_id = organizations[0]

        # 6. Admin MFA Check (Acceptance criteria: admin without MFA blocked)
        if self.require_admin_mfa and ("admin" in roles or "owner" in roles):
            amr = claims.get("amr") or []
            if isinstance(amr, str):
                amr = [amr]
            acr = str(claims.get("acr", "0"))
            has_mfa = any(method in {"otp", "mfa", "totp", "webauthn", "fido2"} for method in amr) or acr in {"1", "2", "gold"}
            if not has_mfa:
                raise AdminMfaRequiredError(
                    f"Admin user {sub} must authenticate with multi-factor authentication (MFA/OTP)"
                )

        return VerifiedToken(
            sub=sub,
            tenant_id=str(tenant_id) if tenant_id else None,
            organizations=organizations,
            roles=roles,
            email=claims.get("email"),
            name=claims.get("name") or claims.get("preferred_username"),
            claims=claims,
        )
