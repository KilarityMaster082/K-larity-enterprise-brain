# @klarity/web-auth

> Owner task: EB-92 Web auth: Keycloak OIDC session and real tenant switch

These are dependency-free auth primitives shared by `apps/web` and `apps/admin`, built only on WebCrypto:

- `signValue` / `verifyValue`: HMAC-SHA256 signed cookie values, with constant-time verification.
- `verifyIdToken`: verifies an OIDC ID token.
  - Accepts RS256 only, so `none` and `HS*` tokens are refused.
  - Checks the signature against the issuer's JWKS.
  - Checks `iss`, `aud`/`azp`, `exp`/`iat`/`nbf` (with clock skew) and `nonce`.
- `organizationsOf`: reads Keycloak Organization aliases, in either claim shape.
- `safeNext`: accepts only same-site relative paths after login, which prevents open redirects.

Run the tests with `pnpm --filter @klarity/web-auth test`.
