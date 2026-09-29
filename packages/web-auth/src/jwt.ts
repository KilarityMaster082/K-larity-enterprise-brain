// Owner task: EB-92 Web auth (shared by apps/web and apps/admin) — verify an OIDC ID token (RS256) against the issuer's JWKS, with no JWT
// library: WebCrypto does the signature check; we check alg, kid, iss, aud, azp, exp, iat, nbf and nonce.
import { b64urlDecode } from "./sign.ts";

export interface Jwk {
  kid?: string;
  kty: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  nbf?: number;
  nonce?: string;
  azp?: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  /** Keycloak Organizations: a list of aliases, or a map alias -> attributes, depending on the mapper. */
  organization?: string[] | Record<string, unknown>;
  [claim: string]: unknown;
}

export class TokenError extends Error {}

const dec = new TextDecoder();

export async function verifyIdToken(
  token: string,
  opts: { jwks: Jwk[]; issuer: string; clientId: string; nonce: string; now?: number; skewSeconds?: number },
): Promise<IdTokenClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new TokenError("malformed token");
  const [h, p, s] = parts as [string, string, string];
  let header: { alg?: string; kid?: string; typ?: string };
  let claims: IdTokenClaims;
  try {
    header = JSON.parse(dec.decode(b64urlDecode(h)));
    claims = JSON.parse(dec.decode(b64urlDecode(p)));
  } catch {
    throw new TokenError("malformed token");
  }
  if (header.alg !== "RS256") throw new TokenError(`unsupported alg ${header.alg}`); // never "none" or HS*
  const jwk = opts.jwks.find((k) => k.kty === "RSA" && (!header.kid || k.kid === header.kid) && (!k.use || k.use === "sig"));
  if (!jwk?.n || !jwk.e) throw new TokenError("no matching signing key");
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlDecode(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new TokenError("bad signature");

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const skew = opts.skewSeconds ?? 60;
  if (claims.iss !== opts.issuer) throw new TokenError("wrong issuer");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(opts.clientId)) throw new TokenError("wrong audience");
  if (aud.length > 1 && claims.azp !== opts.clientId) throw new TokenError("wrong authorized party");
  if (typeof claims.exp !== "number" || claims.exp + skew < now) throw new TokenError("token expired");
  if (typeof claims.iat !== "number" || claims.iat - skew > now) throw new TokenError("token issued in the future");
  if (typeof claims.nbf === "number" && claims.nbf - skew > now) throw new TokenError("token not yet valid");
  if (!claims.nonce || claims.nonce !== opts.nonce) throw new TokenError("nonce mismatch");
  if (!claims.sub) throw new TokenError("missing subject");
  return claims;
}

/** Organization aliases from the token, whichever shape the Keycloak mapper emits. */
export function organizationsOf(claims: IdTokenClaims): string[] {
  const o = claims.organization;
  if (!o) return [];
  if (Array.isArray(o)) return o.filter((x): x is string => typeof x === "string");
  if (typeof o === "object") return Object.keys(o);
  return [];
}
