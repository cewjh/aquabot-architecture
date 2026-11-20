import test from "node:test";
import assert from "node:assert/strict";

import { validateExternalFeedUrl, safeFetchRemoteText } from "../src/core/ssrf.mjs";
import {
  timingSafeEqualStr,
  sha256Hex,
  hmacSha256Hex,
  hashPasswordPbkdf2,
  verifyPasswordPbkdf2,
  createSignedSessionToken,
  verifySignedSessionToken,
  verifyZeroTrustJwt,
} from "../src/core/webcrypto_auth.mjs";

function toBase64Url(objOrBytes) {
  const bytes =
    objOrBytes instanceof Uint8Array
      ? objOrBytes
      : new TextEncoder().encode(JSON.stringify(objOrBytes));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

test("SSRF Guard: enforces HTTPS and blocks loopback, RFC1918, CGNAT, metadata, IPv6, and hex/decimal IPs", () => {
  assert.equal(validateExternalFeedUrl("https://store.example.com/feed.xml"), "https://store.example.com/feed.xml");

  const blocked = [
    "http://store.example.com/feed.xml",
    "ftp://store.example.com/feed.xml",
    "https://localhost/feed.xml",
    "https://127.0.0.1/feed.xml",
    "https://169.254.169.254/latest/meta-data/",
    "https://metadata.google.internal/computeMetadata/v1/",
    "https://10.0.0.5/feed.xml",
    "https://172.16.0.10/feed.xml",
    "https://192.168.1.1/feed.xml",
    "https://100.64.0.1/feed.xml",
    "https://[::1]/feed.xml",
    "https://[fe80::1]/feed.xml",
    "https://[::ffff:127.0.0.1]/feed.xml",
    "https://service.internal/feed.xml",
    "https://user:pass@store.example.com/feed.xml",
    "https://2130706433/feed.xml",
    "https://0x7f000001/feed.xml",
  ];

  for (const url of blocked) {
    assert.throws(() => validateExternalFeedUrl(url), `Expected SSRF block for ${url}`);
  }
});

test("SSRF Safe Fetch: blocks 3xx redirects targeting internal metadata and enforces byte caps", async () => {
  const redirectMock = async () =>
    new Response(null, { status: 302, headers: { Location: "https://169.254.169.254/latest" } });

  await assert.rejects(
    () => safeFetchRemoteText("https://store.example.com/feed.xml", { fetchImpl: redirectMock }),
    /Blocked|Private|internal/i
  );

  const oversizedMock = async () =>
    new Response("x".repeat(256), { status: 200, headers: { "Content-Length": "256" } });

  await assert.rejects(
    () => safeFetchRemoteText("https://store.example.com/feed.xml", { maxBytes: 128, fetchImpl: oversizedMock }),
    /exceeded|exceeds/i
  );
});

test("Web Crypto Auth: PBKDF2-SHA256 100k hashing, HMAC session tokens, and SHA-256 token digests", async () => {
  assert.equal(timingSafeEqualStr("alpha_secret", "alpha_secret"), true);
  assert.equal(timingSafeEqualStr("alpha_secret", "alpha_secrex"), false);
  assert.equal(timingSafeEqualStr("short", "longer"), false);

  const pwdHash = await hashPasswordPbkdf2("StrongEdgePass!2026");
  assert.ok(pwdHash.startsWith("pbkdf2_sha256$100000$"));
  assert.equal(await verifyPasswordPbkdf2("StrongEdgePass!2026", pwdHash), true);
  assert.equal(await verifyPasswordPbkdf2("WrongPass", pwdHash), false);

  const digest1 = await sha256Hex("cc_claim_demo_token");
  const digest2 = await sha256Hex("cc_claim_demo_token");
  assert.equal(digest1.length, 64);
  assert.equal(digest1, digest2);

  const secret = "edge_signing_secret_32_bytes_min";
  const nowSec = 1_760_000_000;
  const tok = await createSignedSessionToken({ id: 42, email: "merchant@example.com", display_name: "Demo" }, secret, 3600, nowSec);
  const verified = await verifySignedSessionToken(tok, secret, nowSec + 60);
  assert.equal(verified?.uid, 42);
  assert.equal(verified?.email, "merchant@example.com");

  // Tampered or expired tokens fail closed
  assert.equal(await verifySignedSessionToken(tok + "a", secret, nowSec + 60), null);
  assert.equal(await verifySignedSessionToken(tok, secret, nowSec + 7200), null);
});

test("Zero Trust JWT: verifies RSASSA-PKCS1-v1_5 signature against JWKS and enforces aud/exp fail-closed", async () => {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"]
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  publicJwk.kid = "zt-key-1";

  const nowSec = 1_760_000_000;
  const headerB64 = toBase64Url({ alg: "RS256", kid: "zt-key-1" });
  const payloadB64 = toBase64Url({
    email: "operator@example.com",
    sub: "user_1",
    aud: ["aud-control-plane"],
    exp: nowSec + 600,
  });
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const sigBuf = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, signingInput);
  const jwt = `${headerB64}.${payloadB64}.${toBase64Url(new Uint8Array(sigBuf))}`;

  const ok = await verifyZeroTrustJwt(jwt, {
    expectedAud: "aud-control-plane",
    getJwks: async () => [publicJwk],
    nowSec,
  });
  assert.equal(ok?.email, "operator@example.com");

  const wrongAud = await verifyZeroTrustJwt(jwt, {
    expectedAud: "aud-other",
    getJwks: async () => [publicJwk],
    nowSec,
  });
  assert.equal(wrongAud, null);

  const expired = await verifyZeroTrustJwt(jwt, {
    expectedAud: "aud-control-plane",
    getJwks: async () => [publicJwk],
    nowSec: nowSec + 1200,
  });
  assert.equal(expired, null);

  // Confirm HMAC helper consistency too
  const mac = await hmacSha256Hex("k", "payload");
  assert.equal(mac.length, 64);
});
