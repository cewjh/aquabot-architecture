# ADR-005: Hybrid Agentic RAG with Deterministic SQL Vector Bypass

* **Status:** Accepted
* **Context:** Running vector embeddings unconditionally on every user message adds avoidable latency and embedding cost, and degrades accuracy on exact inventory queries (e.g., *"cheapest running shoes"* or *"items under \$50"*), where semantic similarity frequently overrides strict price ordering.
* **Decision:** Implement **Hybrid Agentic RAG** combining **Cloudflare Vectorize** (`768d` asymmetric embeddings) with an explicit **SQL Vector Bypass** path (`embedCallCount == 0`) for `sort_by` (`price_asc` / `price_desc`) and wildcard browsing queries (`query: "*"`), paired with model-driven `search_terms[]` query expansion fused via Reciprocal Rank Fusion (`k = 60`) and mandatory D1 multi-tenant hydration.
* **Alternatives Considered:**
  1. *Unconditional Vector Search on Every Turn:* Simpler control flow, but wastes embeddings on non-retrieval turns and misranks exact price-sorted queries.
  2. *Static Application-Level Synonym Dictionaries:* Brittle across languages and retail verticals; replaced by contextual `search_terms: string[]` generated per query by the reasoning model.
  3. *SQL-Only Keyword Matching:* Fast, but fails on symptom-driven or natural-language queries where shoppers do not know exact SKU titles.
* **Consequences & Trade-offs:**
  * **Pros:** `$0` embedding cost on sorted/browsing and cart-edit turns, deterministic price and stock accuracy from D1 hydration, and high semantic recall across languages and industries.
  * **Cons:** Requires strict Layer 2 scripted-trajectory assertions (`embedCallCount == 0`) to ensure prompt or tool changes never regress the bypass path.
