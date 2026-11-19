# ADR-005: Hybrid Agentic RAG with SQL Vector Bypass

* **Status:** Accepted
* **Context:** Running semantic vector search on every user turn introduces unnecessary latency, embedding API cost, and ranking errors on exact queries (e.g., *"cheapest canister filter"* or *"under \$50"*), where semantic similarity often outweighs strict price ordering.
* **Decision:** Implement **Agentic RAG** combining **Cloudflare Vectorize** (768-dim asymmetric embeddings) with an explicit **SQL Vector Bypass** path (`embedCallCount == 0`) for `sort_by` and exact numeric filter queries, followed by mandatory D1 multi-tenant hydration.
* **Alternatives Considered:**
  1. *Unconditional Vector Search on Every Turn:* Simpler pipeline, but wastes embeddings on math/cart turns and performs poorly on price/attribute sorting.
  2. *SQL-Only Keyword Search:* Fast, but fails on natural-language symptom or aquascaping style queries where users don't know exact product names.
* **Consequences & Trade-offs:**
  * **Pros:** Zero embedding cost on non-RAG and sorted queries, deterministic price/stock accuracy via D1 hydration, and semantic recall for descriptive queries.
  * **Cons:** Requires strict Layer 2 scripted-trajectory tests (`embedCallCount == 0` assertions) to ensure prompt/tool edits do not regress the bypass path.

## Amendment (v2 — Vectorize Single Source of Truth & Model-Driven Query Expansion)
* **Refinements:**
  1. Static application-level synonym lookup dictionaries were retired in favor of **model-driven `search_terms: string[]`** generated per query by the reasoning agent and fused with Reciprocal Rank Fusion (`k=60`).
  2. Duplicated 768-float embeddings stored inside D1 JSON columns were removed; D1 retains only a 16-character content fingerprint (`embedded_text_hash`) while **Cloudflare Vectorize acts as the Single Source of Truth** with batch pruning on stock-outs/deletions and strict tenant boundaries (zero silent `'default'` fallback). See [ADR-007](ADR-007-vectorize-single-source-of-truth.md).
