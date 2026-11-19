# ADR-007: Vectorize Single Source of Truth & Strict Tenant Isolation

* **Status:** Accepted
* **Context:** Earlier ingestion stored full 768-dimensional float embeddings inside every row's D1 JSON `specs` blob alongside full `raw_payload` text, inflating database size (`~3+ MB` across a few hundred SKUs) and forcing D1 to transfer redundant floats on every chat turn even when **Cloudflare Vectorize** was available. Additionally, returning `'default'` catalog items when a custom storefront had zero products risked cross-tenant confusion, and out-of-stock/deleted products risked leaving stale vectors in Vectorize.
* **Decision:**
  1. **Vectorize as Single Source of Truth (SSOT):** Store 768-dimensional embeddings exclusively in Cloudflare Vectorize (`shop_domain` + `in_stock` metadata indexes). Retain only a lightweight 16-character content hash (`embedded_text_hash`) inside D1, and use explicit column `SELECT` projection in chat turns to exclude raw ingestion payloads.
  2. **Lifecycle-Synchronized Batch Pruning:** On `1 -> 0` stock transitions or webhook deletions, remove vectors from Vectorize in chunked batches (`20` IDs per call) and clear the D1 hash so `0 -> 1` restocks re-index cleanly while price-only updates incur `$0` embedding cost.
  3. **Strict Tenant Isolation:** Query products strictly with `shop_domain = ? AND in_stock = 1`. Empty custom stores surface an explicit `catalog_empty` signal to the agent rather than falling back to `'default'` inventory, paired with strictly domain-scoped client session keys in `localStorage`.
* **Alternatives Considered:**
  1. *Keep Embeddings inside D1 JSON Rows:* Eliminates external vector index dependency, but degrades D1 row read size/transfer linearly with catalog growth and duplicates Vectorize storage.
  2. *Silent Fallback to Shared Demo Catalog on Custom Domains:* Prevents empty responses during onboarding, but misleads merchants and visitors about actual storefront inventory.
* **Consequences & Trade-offs:**
  * **Pros:** ~88% reduction in D1 `specs` footprint, minimal per-turn Edge SQL payload transfer, clean deletion semantics, and airtight tenant boundaries across custom and Shopify storefronts.
  * **Cons:** Requires running a one-time idempotent Vectorize reindex and D1 JSON pruning step during production cutover (`zero-downtime migration`).
