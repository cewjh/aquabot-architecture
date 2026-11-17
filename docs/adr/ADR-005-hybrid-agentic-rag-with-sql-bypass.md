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
