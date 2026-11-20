/**
 * Zero-dependency Web Crypto Security Core for Edge Workers.
 * Covers constant-time comparison, PBKDF2-SHA256 password hashing,
 * HMAC-SHA256 session tokens, SHA-256 token hashing, and Zero Trust JWKS JWT verification.
 */

const PBKDF2_ITERATIONS = 100000;
const SESSION_TTL_SEC = 7 * 86400;

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  const clean = String(hex || "").trim();
  if (!clean || clean.length % 2 !== 0) return new Uint8Array(0);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function base64UrlEncodeBytes(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlEncodeStr(str) {
  return base64UrlEncodeBytes(new TextEncoder().encode(str));
}

function base64UrlDecodeBytes(b64u) {
  let base64 = String(b64u || "").replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeStr(b64u) {
  return new TextDecoder().decode(base64UrlDecodeBytes(b64u));
}

export function timingSafeEqualStr(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

export async function sha256Hex(input) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(input ?? "")));
  return bytesToHex(new Uint8Array(digest));
}

export async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(message)));
  return bytesToHex(new Uint8Array(sig));
}

export async function hashPasswordPbkdf2(password, saltHex = null) {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(password)),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(new Uint8Array(bits))}`;
}

export async function verifyPasswordPbkdf2(password, storedHash) {
  if (typeof storedHash !== "string" || !storedHash.startsWith("pbkdf2_sha256$")) return false;
  const parts = storedHash.split("$");
  if (parts.length !== 4) return false;

  const iterations = parseInt(parts[1], 10);
  const saltHex = parts[2];
  const expectedHex = parts[3];
  if (!Number.isFinite(iterations) || iterations < 1000 || !saltHex || !expectedHex) return false;

  const salt = hexToBytes(saltHex);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(password)),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return timingSafeEqualStr(bytesToHex(new Uint8Array(bits)), expectedHex);
}

export async function createSignedSessionToken(user, secret, ttlSec = SESSION_TTL_SEC, nowSec = Math.floor(Date.now() / 1000)) {
  if (!secret) throw new Error("Session signing secret is required.");
  const payload = {
    uid: Number(user.id),
    email: String(user.email || ""),
    name: String(user.display_name || ""),
    iat: nowSec,
    exp: nowSec + ttlSec,
  };
  const encoded = base64UrlEncodeStr(JSON.stringify(payload));
  const sig = await hmacSha256Hex(secret, encoded);
  return `${encoded}.${sig}`;
}

export async function verifySignedSessionToken(token, secret, nowSec = Math.floor(Date.now() / 1000)) {
  if (!secret || typeof token !== "string" || !token.includes(".")) return null;
  const [encoded, sig] = token.split(".");
  if (!encoded || !sig) return null;

  const expectedSig = await hmacSha256Hex(secret, encoded);
  if (!timingSafeEqualStr(expectedSig, sig)) return null;

  try {
    const payload = JSON.parse(base64UrlDecodeStr(encoded));
    if (!payload?.uid || !payload?.exp || payload.exp < nowSec) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Verifies a Cloudflare Zero Trust Access JWT (`Cf-Access-Jwt-Assertion`) using RSASSA-PKCS1-v1_5
 * against a JWKS keyset and enforces strict `aud` and `exp` claims (fail-closed).
 */
export async function verifyZeroTrustJwt(
  jwtString,
  { expectedAud, getJwks, nowSec = Math.floor(Date.now() / 1000) }
) {
  if (!jwtString || !expectedAud || typeof getJwks !== "function") return null;
  const parts = String(jwtString).split(".");
  if (parts.length !== 3) return null;

  try {
    const header = JSON.parse(base64UrlDecodeStr(parts[0]));
    const payload = JSON.parse(base64UrlDecodeStr(parts[1]));
    const signature = base64UrlDecodeBytes(parts[2]);
    const dataToVerify = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);

    if (!payload.exp || payload.exp < nowSec) return null;
    if (!payload.aud) return null;

    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(expectedAud)) return null;

    const jwks = await getJwks();
    const keyMatch = (jwks || []).find((k) => k.kid === header.kid);
    if (!keyMatch) return null;

    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      keyMatch,
      { name: "RSASSA-PKCS1-v1_5", hash: { name: "SHA-256" } },
      false,
      ["verify"]
    );
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, signature, dataToVerify);
    if (!valid) return null;

    return {
      email: payload.email || payload.common_name || "authenticated_user",
      sub: payload.sub,
      type: payload.type || "access",
    };
  } catch {
    return null;
  }
}
