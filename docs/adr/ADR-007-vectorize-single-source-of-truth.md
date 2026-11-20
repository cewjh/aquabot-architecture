# ADR-007: Vectorize Single Source of Truth & Strict Tenant Isolation

* **Status:** Accepted
* **Context:** Storing full 768-dimensional float embeddings inside relational D1 JSON blobs alongside raw ingestion payloads inflates database size, slows per-turn SQL hydration, and risks stale vectors remaining searchable when products go out of stock or are deleted. Furthermore, falling back to a shared `'default'` catalog when a custom tenant has zero synced products risks cross-tenant data confusion.
* **Decision:**
  1. **Vectorize as Single Source of Truth (SSOT):** Store 768-dimensional embeddings exclusively in Cloudflare Vectorize (`shop_domain`, `doc_type`, `in_stock`, `category`, `brand` metadata indexes). Retain only a lightweight 16-character content hash (`embedded_text_hash`) inside D1, and use explicit column `SELECT` projection in chat turns to exclude `raw_payload`.
  2. **Lifecycle-Synchronized Batch Pruning:** On `1 -> 0` stock transitions or catalog deletions, remove vectors from Vectorize in chunked batches (`20` IDs per call) and clear the D1 hash so `0 -> 1` restocks re-index cleanly while price-only updates incur `$0` embedding cost.
  3. **Strict Tenant Isolation:** Query products strictly with `shop_domain = ? AND in_stock = 1`. Empty custom stores surface an explicit `catalog_empty` signal to the agent rather than falling back to `'default'` inventory, paired with strictly domain-scoped client session keys in `localStorage`.
* **Alternatives Considered:**
  1. *Keep Embeddings inside D1 JSON Rows:* Eliminates external vector index dependency, but degrades D1 row transfer linearly with catalog growth.
  2. *Silent Fallback to Shared Demo Catalog on Custom Domains:* Prevents empty responses during early onboarding, but misleads merchants and visitors about actual storefront inventory.
* **Consequences & Trade-offs:**
  * **Pros:** ~88% reduction in D1 catalog row footprint, minimal per-turn Edge SQL transfer, clean deletion semantics, and airtight tenant isolation across storefronts.
  * **Cons:** Requires idempotent batch re-indexing tooling (`embedded_text_hash` reconciliation) when embedding model dimensions or text templates evolve.
