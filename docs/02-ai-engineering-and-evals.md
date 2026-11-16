# 02 — AI Engineering, Guardrails & 3-Layer Testing Pyramid

Building reliable agentic systems requires treating prompt engineering, tool routing, and LLM evaluation with the same rigor as backend APIs. AquaBot enforces a **Zero-Hallucination Policy** backed by a **3-Layer AI Agent Testing Pyramid**.

---

## 1. Agentic RAG & Zero-Hallucination Guardrails

LLMs are probabilistic text generators; they must not be trusted with arithmetic, inventory availability, or pricing:

* **Agentic RAG (Cloudflare Vectorize + Query Cache):** Rather than running blind retrieval on every message, the ReAct agent autonomously decides whether a turn requires catalog retrieval. When semantic matching is needed (e.g., problem-solving or symptom queries), it generates 768-dimensional embeddings (with in-memory `RETRIEVAL_QUERY` caching) and queries **Cloudflare Vectorize**, then hydrates verified tenant records from D1.
* **Vector Bypass for Exact Queries:** When a user requests deterministic sorting or filtering (e.g., *"cheapest external filter"* or *"under \$50"*), the system bypasses semantic embedding search (`embedCallCount == 0`) and executes indexed SQL queries directly.
* **Deterministic Domain Engine:** Tank volume, glass thickness tolerances, substrate slope volume, filtration turnover ($L/h$), and lighting requirements ($lm/L$) are computed deterministically in code—never by the LLM.
* **Catalog Grounding:** Every recommended product is cross-checked against the tenant's D1 inventory (`in_stock = 1` and matching `shop_domain`).

---

## 2. The 3-Layer AI Agent Testing Pyramid

AquaBot explicitly avoids the **"Inverted Pyramid" anti-pattern** (relying on slow, expensive LLM-as-a-Judge tests for rules that deterministic unit tests can verify in milliseconds).

```text
          /\
         /  \        Layer 3: Live Edge DeepEval, G-Eval & Red-Teaming
        /----\       (Real LLM + Real Edge: RAG faithfulness, tone, adversarial)
       /      \
      /--------\     Layer 2: Scripted-Trajectory & Mock Integration
     /          \    (Mock D1 + Mock LLM Gateway: tool routing, Vector Bypass, cart)
    /------------\
   /              \  Layer 1: Deterministic Unit, Contract & Security
  ------------------ ($0 cost, ms: math formulas, UTF-8 SSE, HMAC, SSRF, auth)
```

### Layer 1 — Deterministic Unit, Contract & Security (`$0` Cost, Milliseconds)
* Verifies mathematical formulas, UTF-8 multi-byte SSE chunk boundaries, `thoughtSignature` preservation, Pydantic v2 input schemas, `HMAC-SHA256` verification, SSRF guards, and rate limits.

### Layer 2 — Scripted-Trajectory & Mock Integration (Pre-Deploy Gate)
* Runs against mocked D1/R2 state and a local HTTP LLM gateway stub.
* Asserts **behavioral trajectories** rather than brittle exact-string matches:
  * Did the agent select the right tool?
  * Was `embedCallCount == 0` enforced on `sort_by` queries?
  * Were out-of-stock or cross-tenant items excluded?
  * Did `update_cart` mutate session state cleanly?

### Layer 3 — DeepEval / G-Eval & Red-Teaming (Quality Gate)
* Evaluates real end-to-end behavior using **DeepEval**:
  * **RAG-enabled turns** (catalog search): `ContextualRelevancyMetric`, `FaithfulnessMetric`, `ToolCorrectnessMetric`, and `GEval` with `RETRIEVAL_CONTEXT`.
  * **Non-RAG turns** (calculations, cart updates, consultation, red-teaming): `ToolCorrectnessMetric` + `GEval` (`INPUT`, `ACTUAL_OUTPUT` only—no `RETRIEVAL_CONTEXT`).
  * **Adversarial Red-Teaming:** Prompt injection attempts, system prompt extraction, and out-of-domain queries (e.g., uploading non-aquarium images).
