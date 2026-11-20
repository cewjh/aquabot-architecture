# Security Architecture & Multi-Tenant Isolation (`SECURITY.md`)

Commerce Copilot operates as a shared multi-tenant SaaS platform at the Cloudflare edge. Security controls are enforced fail-closed across the **Data Plane**, **Control Plane**, **Tenant Self-Service Plane**, **External Connectors**, and **Storefront Widget**.

> **Testable Security Reference Modules:** [`references/src/core/ssrf.mjs`](references/src/core/ssrf.mjs), [`references/src/core/webcrypto_auth.mjs`](references/src/core/webcrypto_auth.mjs)

---

## 1. Strict Multi-Tenant Isolation

* **Relational & Vector Partitioning:** Every D1 query (`products`, `store_knowledge`, `chat_sessions`, `analytics_events`) enforces `WHERE shop_domain = ?` and every Vectorize query filters by `{ shop_domain }`.
* **Zero Silent Demo Fallback:** Custom stores with zero synced products never fall back to `'default'` catalog items; the agent receives `catalog_empty` and reports availability honestly.
* **Domain-Scoped Client State:** The Shadow DOM widget namespaces `localStorage` session identifiers strictly per storefront domain, preventing cross-domain session leakage.
* **Merchant Ownership Isolation (`shop_members`):** Every `/api/v1/merchant/shops/:domain/*` request verifies membership in `shop_members` (`403 Forbidden` otherwise) and applies strict field whitelisting so merchants cannot escalate `plan_id` or FinOps spend caps.

---

## 2. Authentication & Cryptographic Primitives

| Surface | Mechanism | Fail-Closed Guarantees |
| :--- | :--- | :--- |
| **Control Plane (`cloudflare-admin`)** | Cloudflare Zero Trust JWT (`Cf-Access-Jwt-Assertion`) | RSASSA-PKCS1-v1_5 verification against cached team JWKS; rejects missing/mismatched `aud` or expired `exp` |
| **Core Admin APIs** | `X-Admin-Key` | Fails closed with `503` if server secret is unconfigured; constant-time `timingSafeEqualStr` check |
| **Merchant Portal (`/dashboard`)** | Web Crypto `PBKDF2-SHA256` + HMAC Cookie | `100,000` iterations, 16-byte random salt; HMAC-SHA256 `HttpOnly; Secure; SameSite=Lax` cookie |
| **Claim & Ingest Tokens** | `cc_claim_...` / `cc_ing_...` | Raw secrets shown once at issuance; stored exclusively as 64-char `SHA-256` hex digests in `shop_claim_tokens` |
| **Shopify OAuth & Webhooks** | Signed `state` + `HMAC-SHA256` | Verifies `X-Shopify-Hmac-Sha256` before any catalog or GDPR mutation; fails closed if secret absent |

---

## 3. External Ingestion & SSRF Defense-in-Depth

All outbound HTTP fetches (`xml_feed.mjs`, `platform_detect.mjs`, policy URL ingestion) run through `ssrf.mjs`:
* Enforces `https:` only (rejecting `http:`, `ftp:`, and embedded `user:pass@` credentials).
* Blocks loopback, RFC1918, CGNAT (`100.64.0.0/10`), cloud metadata (`169.254.169.254`, `metadata.google.internal`), `.internal`/`.local` suffixes, decimal/hex IP obfuscation, and IPv6 private/mapped ranges (including WHATWG hex-normalized `::ffff:7f00:1`).
* Uses `redirect: "manual"` and re-validates every `3xx` `Location` target (`maxRedirects = 3`) alongside strict byte caps and `AbortController` timeouts.

---

## 4. Client, Media & Cognitive Agent Hardening

* **Hardened Image Proxy (R2):** Visitor-uploaded images undergo magic-byte verification (PNG/JPEG/WebP) and are served through a proxy enforcing `X-Content-Type-Options: nosniff` and a strict `sandbox` Content-Security-Policy.
* **XSS & Theme Injection Prevention:** Merchant `primary_color` values require strict `#RRGGBB` hex validation before entering Shadow DOM CSS custom properties; HTML outputs escape untrusted strings.
* **Rate Limiting & FinOps Ceilings:** Edge IP rate limiters, per-turn spend caps, `maxSteps` loop bounds, and `(toolName, args)` circuit breakers protect LLM quotas against abuse and prompt-injection loops.
* **Honest Cart Boundaries:** The storefront `CartAdapter` never renders false "Added to Cart" states when Shopify/WooCommerce returns `422` out-of-stock or `5xx` errors.
