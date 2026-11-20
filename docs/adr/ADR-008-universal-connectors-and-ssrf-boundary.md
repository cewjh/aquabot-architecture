# ADR-008: Universal Catalog Connectors, Auto-Discovery & SSRF Boundary

* **Status:** Accepted
* **Context:** Supporting only Shopify OAuth limits addressable merchants to a single ecosystem. Merchants across WooCommerce, regional platforms (ikas, Ticimax, T-Soft), and custom headless storefronts require standardized ingestion via XML feeds or REST APIs—while allowing user-supplied URLs for feed sync or platform detection introduces severe Server-Side Request Forgery (SSRF) risk at the edge.
* **Decision:**
  1. **Three Universal Ingestion Paths:** Normalize Shopify Native (OAuth + fail-closed HMAC webhooks + `/policies.json`), Google Merchant / Meta XML Feeds (RSS 2.0 & Atom with `<g:item_group_id>` variant grouping), and a scoped REST Push API (`POST /api/v1/catalog/ingest` authenticated by SHA-256 hashed `X-Merchant-Ingest-Key`) into a unified `(shop_domain, external_id)` catalog schema.
  2. **Wappalyzer-Style Auto-Discovery:** Provide a multi-signal storefront scanner (`platform_detect.mjs`) analyzing HTTP headers, HTML meta/hydration tokens, CDN paths, `<link rel="alternate">` feeds, and `/robots.txt` sitemaps during onboarding.
  3. **Strict SSRF Guard (`ssrf.mjs`):** Enforce HTTPS-only URLs, block loopback/RFC1918/CGNAT/link-local/cloud-metadata/IPv6-mapped addresses (including WHATWG hex-normalized `::ffff:7f00:1`) and decimal/hex IP obfuscation, disable automatic redirects (`redirect: "manual"` with per-hop re-validation), and cap response bytes and timeouts.
* **Alternatives Considered:**
  1. *Shopify-Only Integration:* Lowers initial surface area, but blocks adoption across non-Shopify storefronts.
  2. *Standard `fetch(url)` Without Redirect/IP Validation:* Vulnerable to cloud metadata probing and internal network scanning via `302` redirects.
* **Consequences & Trade-offs:**
  * **Pros:** Platform-agnostic onboarding in seconds, clean multi-variant consolidation from flat Google Merchant feeds, and defense-in-depth against SSRF.
  * **Cons:** Requires maintaining streaming-safe XML parsing and strict SSRF regression tests (`references/tests/security_and_auth.test.mjs`).
