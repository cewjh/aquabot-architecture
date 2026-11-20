# ADR-006: Single-Brain Parallel ReAct Loop & Zero-Cost Streaming Synthesis

* **Status:** Accepted
* **Context:** Multi-stage agent pipelines that separate tool routing, hidden non-streamed JSON SKU selection, and final text synthesis introduce redundant latency, double prompt/catalog token burn, context split-brain between vision and product selection, and brittle static follow-up buttons.
* **Decision:**
  1. **Single-Brain Static ACI & Schema Thought Slots:** Consolidate orchestration into one **Provider- and Domain-Agnostic Bounded Native ReAct Loop** backed by a static `read` / `write` Tool Registry (`search_catalog`, `compare_products`, `search_store_knowledge`, `create_cart_bundle`, `modify_cart`, `handoff_to_support`, plus optional domain calculators such as `calculate_aquarium_specs`). All declarations use strict `parametersJsonSchema` (`additionalProperties: false`), equipping read tools with a leading `intent` field (**Schema-Level Thought Slot**).
  2. **KV-Cache Prefix Stability (Static Prefix, Native `AUTO`) & Parallel Reads:** Keep tool declarations strictly fixed across every step in native `AUTO` mode so prompt-prefix KV caching stays intact. Execute independent read-only calls concurrently via `Promise.all`, execute write mutations serially, and interleave multi-search results round-robin.
  3. **Fail-Loud Self-Correcting Boundaries:** Validate explicit `variant_id` and SKU bounds deterministically inside `create_cart_bundle` / `modify_cart`, rejecting invalid variants with `available_variants[]` (never silently downgrading) and executing atomic `replace` swaps so the ReAct loop self-corrects within the same turn.
  4. **Bounded Safety, Sliding-Tail `<quick_replies>` & Graceful Wrap-Up:** Guard execution with `maxSteps = 8`, per-turn spend ceiling, a `(toolName, normalizedArgs)` loop circuit breaker (`seenCount > 2`), a tool-free wrap-up synthesis fallback, and `$0` sliding-tail SSE `<quick_replies>` extraction.
* **Alternatives Considered:**
  1. *Dual-LLM Non-Streamed JSON Selection:* Guarantees schema structure, but doubles LLM round-trips and duplicates prompt/catalog tokens.
  2. *Single Polymorphic Cart Mega-Tool + Forced Decoding:* Overloads one schema with full-bundle creation and incremental cart edits, degrading tool-call reliability on compact models.
  3. *Mid-Loop Dynamic Tool Filtering:* Removes tools per step, invalidating prompt-prefix KV caches and decoupling history from active declarations.
* **Consequences & Trade-offs:**
  * **Pros:** Rich conversational continuity (vision + comparison + cart mutation in one context), preserved KV-cache prefix across turns, shallow single-purpose write schemas, fail-loud self-correction on invalid SKUs/variants, and multilingual dynamic follow-up chips at `$0` extra inference cost.
  * **Cons:** Requires strict backend SKU/stock/variant verification across write tools, canonical `Read -> Write -> Synthesize` multi-turn history reconstruction, and intent-driven prompting so catalog language does not override user reply language.
