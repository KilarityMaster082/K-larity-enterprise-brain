// Owner task: EB-92 Web auth (shared by apps/web and apps/admin) — HMAC-SHA256 signing for cookies (WebCrypto; runs in Node and the proxy).

const enc = new TextEncoder();

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** `payload.signature`, both base64url. */
export async function signValue(value: unknown, secret: string): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify(value)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

/** Returns the value, or null if the signature is wrong or the token is malformed (constant-time verify). */
export async function verifyValue<T>(token: string | undefined, secret: string): Promise<T | null> {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), b64urlDecode(token.slice(dot + 1)), enc.encode(payload));
    if (!ok) return null;
    return JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as T;
  } catch {
    return null;
  }
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256b64url(input: string): Promise<string> {
  return b64url(await crypto.subtle.digest("SHA-256", enc.encode(input)));
}
