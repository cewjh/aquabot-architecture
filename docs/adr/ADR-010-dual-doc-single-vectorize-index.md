# ADR-010: Dual-Document Single Vectorize Index Over Separate Vector Indexes

* **Status:** Accepted
* **Context:** The AI assistant retrieves both **product catalog items** (for shopping, sizing, and bundling) and **store policy / FAQ documents** (shipping, returns, warranties, store policies). Managing separate Vectorize indexes per document type increases wrangler binding complexity, synchronization logic, and operational overhead per environment.
* **Decision:** Store both product embeddings (`prod:<shopHash>:<extHash>`) and store knowledge embeddings (`know:<shopHash>:<docKeyHash>`) inside a **single Cloudflare Vectorize index** (`768d`, cosine), partitioned strictly via indexed metadata attributes (`shop_domain`, `doc_type: "product" | "knowledge"`, `in_stock`, `category`, `brand`, `knowledge_type`).
* **Alternatives Considered:**
  1. *Separate Vectorize Indexes (`products-index` + `knowledge-index`):* Clean physical separation, but doubles index bindings, provisioning scripts, and batch lifecycle tooling.
  2. *Unpartitioned Mixed Index Without `doc_type` Filter:* Risks surfacing return-policy text inside product searches or products inside warranty lookups.
* **Consequences & Trade-offs:**
  * **Pros:** Single Vectorize binding and batch upsert/delete pipeline, clean logical isolation via mandatory `doc_type` metadata filters, and zero raw embedding bloat in D1.
  * **Cons:** Requires disciplined vector ID prefixing (`prod:` vs. `know:`) and mandatory metadata filter enforcement in every RAG query helper.
