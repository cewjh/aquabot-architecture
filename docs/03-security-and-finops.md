# 03 — Multi-Tenant Security, Shopify Integration & FinOps

AquaBot operates as a shared multi-tenant SaaS platform at the edge. Security boundaries and unit-economics controls are enforced at the infrastructure and query layers.

---

## 1. Multi-Tenant Data Isolation

All core tables (`shops`, `products`, `chat_sessions`, `analytics_events`) are scoped by `shop_domain`:
* Every catalog lookup enforces strict tenant filtering (`WHERE (shop_domain = ? OR shop_domain = 'default') AND in_stock = 1`).
* A visitor on Store A can never enumerate or receive products, pricing, or session state belonging to Store B.

---

## 2. Edge Security Controls

* **Fail-Closed Shopify Webhooks:** Incoming `products/update` and `products/delete` webhooks are verified via `HMAC-SHA256` against `X-Shopify-Hmac-Sha256` before any D1 mutation occurs.
* **Signed OAuth State:** Shopify `/auth` $\rightarrow$ `/callback` flows validate HMAC signatures and signed `state` parameters to prevent CSRF.
* **Hardened Image Serving (R2):** User-uploaded images stored in Cloudflare R2 are served through a dedicated proxy route with `X-Content-Type-Options: nosniff` and a restrictive `sandbox` Content-Security-Policy header.
* **Rate Limiting & Input Bounds:** IP-based rate limiting (`CHAT_RATE_LIMITER`) and payload size bounds protect both the Edge Worker and downstream LLM quotas.
* **Zero Trust Admin Plane:** Administrative and FinOps endpoints (`cloudflare-admin`) are isolated behind `Cf-Access-Jwt-Assertion` (Cloudflare Zero Trust JWKS + Audience verification) or dedicated secret headers.

---

## 3. FinOps & Zero-Cost Incremental Ingestion

Running multimodal AI agents for e-commerce requires tight cost governance:
* **Hash-Based Zero-Cost Ingestion:** During Shopify catalog syncs, product descriptions are hashed. Only newly added or modified products trigger LLM spec-enrichment; unchanged items incur `$0` LLM cost.
* **AI Gateway Caching:** Non-streamed deterministic/enrichment calls route through Cloudflare AI Gateway with configurable caching and rate limits.
* **Per-Session & Per-Tenant Cost Tracking:** `finops_settings` and `subscription_plans` track token pricing, active model selection, and `session_cost_usd` per conversation in real time.
