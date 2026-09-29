// Owner task: EB-92 Web auth — signed cookies, ID-token verification and redirect safety.
import assert from "node:assert/strict";
import { test } from "node:test";

import { b64url, organizationsOf, safeNext, signValue, TokenError, verifyIdToken, verifyValue, type Jwk } from "../src/index.ts";

const enc = new TextEncoder();
const SECRET = "test-secret-that-is-long-enough-000000";

test("signed values round-trip and reject tampering or the wrong secret", async () => {
  const token = await signValue({ tenantId: "studio8", role: "owner" }, SECRET);
  assert.deepEqual(await verifyValue(token, SECRET), { tenantId: "studio8", role: "owner" });
  const [payload, sig] = token.split(".") as [string, string];
  const forged = b64url(enc.encode(JSON.stringify({ tenantId: "synthetic-canary", role: "owner" })));
  assert.equal(await verifyValue(`${forged}.${sig}`, SECRET), null, "payload swapped");
  assert.equal(await verifyValue(`${payload}.${sig.slice(0, -2)}xx`, SECRET), null, "signature edited");
  assert.equal(await verifyValue(token, SECRET + "x"), null, "wrong secret");
  assert.equal(await verifyValue("garbage", SECRET), null);
  assert.equal(await verifyValue(undefined, SECRET), null);
});

// ---------------------------------------------------------------- ID tokens
const ISS = "https://sso.example/realms/klarity";
const CLIENT = "klarity-web";

async function keypair(kid: string) {
  const kp = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as Jwk;
  return { priv: kp.privateKey, jwk: { ...jwk, kid, use: "sig", alg: "RS256" } as Jwk };
}

async function sign(priv: CryptoKey, header: object, claims: object): Promise<string> {
  const h = b64url(enc.encode(JSON.stringify(header)));
  const p = b64url(enc.encode(JSON.stringify(claims)));
  const s = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", priv, enc.encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(s)}`;
}

const now = Math.floor(Date.now() / 1000);
const good = { iss: ISS, aud: CLIENT, sub: "user-1", exp: now + 300, iat: now, nonce: "n-123", organization: ["studio8"] };

test("a valid RS256 ID token is accepted", async () => {
  const k = await keypair("k1");
  const t = await sign(k.priv, { alg: "RS256", kid: "k1" }, good);
  const claims = await verifyIdToken(t, { jwks: [k.jwk], issuer: ISS, clientId: CLIENT, nonce: "n-123" });
  assert.equal(claims.sub, "user-1");
  assert.deepEqual(organizationsOf(claims), ["studio8"]);
});

test("every forged or misdirected token is refused", async () => {
  const k = await keypair("k1");
  const other = await keypair("k2");
  const opts = { jwks: [k.jwk], issuer: ISS, clientId: CLIENT, nonce: "n-123" };
  const cases: [string, Promise<string>][] = [
    ["wrong issuer", sign(k.priv, { alg: "RS256", kid: "k1" }, { ...good, iss: "https://evil.example" })],
    ["wrong audience", sign(k.priv, { alg: "RS256", kid: "k1" }, { ...good, aud: "another-client" })],
    ["multi-audience without azp", sign(k.priv, { alg: "RS256", kid: "k1" }, { ...good, aud: [CLIENT, "x"] })],
    ["expired", sign(k.priv, { alg: "RS256", kid: "k1" }, { ...good, exp: now - 3600 })],
    ["issued in the future", sign(k.priv, { alg: "RS256", kid: "k1" }, { ...good, iat: now + 3600 })],
    ["not yet valid", sign(k.priv, { alg: "RS256", kid: "k1" }, { ...good, nbf: now + 3600 })],
    ["nonce mismatch (replay)", sign(k.priv, { alg: "RS256", kid: "k1" }, { ...good, nonce: "other" })],
    ["missing nonce", sign(k.priv, { alg: "RS256", kid: "k1" }, { ...good, nonce: undefined })],
    ["signed by an unknown key", sign(other.priv, { alg: "RS256", kid: "k1" }, good)],
    ["unknown kid", sign(k.priv, { alg: "RS256", kid: "rotated-away" }, good)],
  ];
  for (const [name, t] of cases) {
    await assert.rejects(verifyIdToken(await t, opts), TokenError, name);
  }
  const t = await sign(k.priv, { alg: "RS256", kid: "k1" }, good);
  const [h, , s] = t.split(".");
  const tampered = `${h}.${b64url(enc.encode(JSON.stringify({ ...good, sub: "admin" })))}.${s}`;
  await assert.rejects(verifyIdToken(tampered, opts), TokenError, "tampered payload");
  const none = `${b64url(enc.encode(JSON.stringify({ alg: "none" })))}.${b64url(enc.encode(JSON.stringify(good)))}.`;
  await assert.rejects(verifyIdToken(none, opts), TokenError, "alg none");
  const hs = `${b64url(enc.encode(JSON.stringify({ alg: "HS256", kid: "k1" })))}.${b64url(enc.encode(JSON.stringify(good)))}.${s}`;
  await assert.rejects(verifyIdToken(hs, opts), TokenError, "alg HS256 (key confusion)");
  await assert.rejects(verifyIdToken("not.a", opts), TokenError, "malformed");
});

test("organization claim in both Keycloak shapes", () => {
  const base = { ...good, organization: undefined } as Parameters<typeof organizationsOf>[0];
  assert.deepEqual(organizationsOf({ ...base, organization: ["a", "b"] }), ["a", "b"]);
  assert.deepEqual(organizationsOf({ ...base, organization: { a: { id: "1" }, b: {} } }), ["a", "b"]);
  assert.deepEqual(organizationsOf(base), []);
});

test("post-login redirects stay on this site", () => {
  assert.equal(safeNext("/projects/phoenix"), "/projects/phoenix");
  assert.equal(safeNext("/ask?q=hi"), "/ask?q=hi");
  for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/api/auth/login", "/login", "", null, 42, "/ok\r\nSet-Cookie: x"]) {
    assert.equal(safeNext(bad), "/ask", String(bad));
  }
});
