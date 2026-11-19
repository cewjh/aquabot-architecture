# 04 — Multi-Tenant Security, Shopify Integration & FinOps

AquaBot operates as a shared multi-tenant SaaS platform at the edge. Tenant boundaries, storefront integration integrity, and unit-economics guardrails are enforced at the database, worker, and widget layers.

---

## 1. Strict Multi-Tenant Data & Session Isolation

All core tables (`shops`, `products`, `chat_sessions`, `analytics_events`) and Vectorize metadata filters are strictly scoped by `shop_domain`:
* **Zero Cross-Tenant Catalog Leakage:** Every catalog query filters strictly by `WHERE shop_domain = ? AND in_stock = 1` (plus Vectorize metadata `filter: { shop_domain, in_stock: 1 }`). Custom stores with zero synced products never fall back silently to a shared `'default'` catalog; instead, the agent receives `catalog_empty` and informs the visitor transparently.
* **Domain-Scoped Client Sessions:** The storefront widget stores session identifiers strictly under domain-scoped `localStorage` keys without writing shared global session keys, preventing session bleeding across storefronts or preview domains.

---

## 2. Edge & Storefront Security Controls

* **Fail-Closed Admin Auth & Zero Trust Plane:** Administrative routes fail closed (`503`) if server admin secrets are absent and require constant/verified credentials (`X-Admin-Key`); the management plane (`cloudflare-admin`) verifies Cloudflare Zero Trust JWTs (`Cf-Access-Jwt-Assertion` + JWKS + `ZERO_TRUST_AUD`).
* **Fail-Closed Shopify Webhooks & Signed OAuth:** Incoming webhooks (`products/create`, `products/update`, `products/delete`, `app/uninstalled`, GDPR endpoints) verify `HMAC-SHA256` against `X-Shopify-Hmac-Sha256` before any mutation. OAuth `/auth` $\rightarrow$ `/callback` validates signed `state` tokens and expiring token rotation.
* **Hardened Image Serving (R2):** User-uploaded tank images stored in Cloudflare R2 are served through a dedicated proxy with `X-Content-Type-Options: nosniff` and a strict `sandbox` Content-Security-Policy.
* **Rate Limiting, SSRF & Input Guards:** IP-based rate limiting, strict message/image payload bounds, valid `#RRGGBB` hex validation before CSS theme injection, and domain allowlists protect both the Worker and downstream LLM quotas.
* **Honest Cart Adapter Boundaries:** Storefront cart mutations never invent success UI when Shopify returns `422`/`5xx` inventory errors and avoid blind Shopify endpoint calls on non-Shopify websites.

---

## 3. FinOps & Infrastructure Efficiency

Running multimodal AI agents for e-commerce requires tight control over tokens, database I/O, and vector storage:
* **D1 Vector Bloat Elimination (~88% Storage Reduction):** Removing duplicated 768-float embedding arrays from D1 JSON columns and storing vectors solely inside Vectorize (keeping only a 16-char hash in D1 and omitting `raw_payload` via explicit SQL projection) cuts per-turn D1 payload transfer dramatically at scale.
* **Eliminating Hidden Double-Inference:** Replacing the 2nd hidden structured-JSON selection LLM call with single-brain tool calling reduces per-turn latency and token burn on multi-product bundles while piggybacking `<quick_replies>` on the synthesis stream at `$0` additional LLM cost.
* **N+1 Query Elimination & Real Funnel Revenue:** Shop listings aggregate counts in a single `LEFT JOIN ... GROUP BY` query, and funnel revenue computes real SQL `SUM` over logged cart values instead of static price estimates.
* **Hash-Based Incremental Ingestion & Real-Time Spend Caps:** Only products whose semantic hash changes trigger re-embedding or background LLM enrichment; `finops_settings`, `subscription_plans`, per-turn budgets, and session cost tracking (`session_cost_usd`) enforce hard spend limits without fabricating fake responses on quota exhaustion.
