// Owner task: EB-92 Web auth — OpenID Connect Authorization Code flow with PKCE against Keycloak
// (Organizations, ADR-013). Discovery and JWKS are fetched from the issuer and cached for 10 minutes.
import { verifyIdToken, type IdTokenClaims, type Jwk } from "@klarity/web-auth";
import { randomToken, sha256b64url } from "@klarity/web-auth";
import type { OidcConfig } from "./config";

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
}

const TTL = 10 * 60 * 1000;
let discoveryCache: { at: number; issuer: string; doc: Discovery } | null = null;
let jwksCache: { at: number; uri: string; keys: Jwk[] } | null = null;

export async function discovery(cfg: OidcConfig): Promise<Discovery> {
  if (discoveryCache && discoveryCache.issuer === cfg.issuer && Date.now() - discoveryCache.at < TTL) return discoveryCache.doc;
  const res = await fetch(`${cfg.issuer}/.well-known/openid-configuration`, { cache: "no-store" });
  if (!res.ok) throw new Error(`OIDC discovery failed: HTTP ${res.status}`);
  const doc = (await res.json()) as Discovery;
  if (doc.issuer !== cfg.issuer) throw new Error("OIDC discovery issuer mismatch");
  discoveryCache = { at: Date.now(), issuer: cfg.issuer, doc };
  return doc;
}

async function jwks(uri: string, force = false): Promise<Jwk[]> {
  if (!force && jwksCache && jwksCache.uri === uri && Date.now() - jwksCache.at < TTL) return jwksCache.keys;
  const res = await fetch(uri, { cache: "no-store" });
  if (!res.ok) throw new Error(`JWKS fetch failed: HTTP ${res.status}`);
  const keys = ((await res.json()) as { keys: Jwk[] }).keys;
  jwksCache = { at: Date.now(), uri, keys };
  return keys;
}

export interface LoginRequest {
  state: string;
  nonce: string;
  verifier: string;
  next: string;
  org?: string;
}

/** Identity providers the sign-in page may pre-select (Keycloak broker aliases). Anything else is ignored. */
export const IDP_HINTS = ["google"] as const;
export type IdpHint = (typeof IDP_HINTS)[number];

export async function beginLogin(cfg: OidcConfig, next: string, org?: string, idp?: IdpHint): Promise<{ url: string; req: LoginRequest }> {
  const d = await discovery(cfg);
  const req: LoginRequest = { state: randomToken(), nonce: randomToken(), verifier: randomToken(48), next, org };
  const scope = ["openid", "profile", "email", org ? `organization:${org}` : "organization"].join(" ");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: `${cfg.appUrl}/api/auth/callback`,
    scope,
    state: req.state,
    nonce: req.nonce,
    code_challenge: await sha256b64url(req.verifier),
    code_challenge_method: "S256",
    ...(idp ? { kc_idp_hint: idp } : {}),
  });
  return { url: `${d.authorization_endpoint}?${params}`, req };
}

export async function finishLogin(cfg: OidcConfig, code: string, req: LoginRequest): Promise<IdTokenClaims> {
  const d = await discovery(cfg);
  const res = await fetch(d.token_endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${btoa(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${cfg.appUrl}/api/auth/callback`,
      code_verifier: req.verifier,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`token exchange failed: HTTP ${res.status}`);
  const body = (await res.json()) as { id_token?: string };
  if (!body.id_token) throw new Error("no id_token in token response");
  const opts = { issuer: cfg.issuer, clientId: cfg.clientId, nonce: req.nonce };
  try {
    return await verifyIdToken(body.id_token, { ...opts, jwks: await jwks(d.jwks_uri) });
  } catch (e) {
    // Key rotation: refetch the key set once, then give up.
    return verifyIdToken(body.id_token, { ...opts, jwks: await jwks(d.jwks_uri, true) }).catch(() => {
      throw e;
    });
  }
}

export async function logoutUrl(cfg: OidcConfig): Promise<string | null> {
  const d = await discovery(cfg).catch(() => null);
  if (!d?.end_session_endpoint) return null;
  const params = new URLSearchParams({ client_id: cfg.clientId, post_logout_redirect_uri: `${cfg.appUrl}/login` });
  return `${d.end_session_endpoint}?${params}`;
}
