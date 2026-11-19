# 03 — AI Engineering, Guardrails & 3-Layer Testing Pyramid

Building reliable agentic systems requires separating deterministic correctness from semantic judgment. AquaBot enforces a **Zero-Hallucination Policy** verified by a **3-Layer AI Agent Testing Pyramid** plus headless browser E2E testing.

---

## 1. Zero-Hallucination Agentic Guardrails

1. **Deterministic Domain Physics:** Tank volumes, glass thickness tolerances, substrate slope targets, circulation flow (`L/h`), heater wattage, and lumen targets are calculated deterministically in code—never guessed by an LLM.
2. **Verified Multi-Variant Grounding:** Both tool outputs and RAG `retrieval_context` expose explicit variant-level pricing (`available_variants`), preventing mismatches between base prices and selected capacity/wattage variants during multi-variant synthesis and evaluation.
3. **Strict Empty-Catalog & Language Guardrails:** Stores with zero online products never fall back to a demo catalog; the model receives an explicit empty-catalog tool status and reports unavailability honestly. Prompt instructions and tool responses enforce strict response/quick-reply language alignment with the user's latest message.
4. **No Silent Category Substitution:** If a cart mutation references an invalid or out-of-stock SKU ID, the cart builder rejects it explicitly (`not_found_ops`) so the ReAct loop self-corrects rather than silently swapping an unrelated item category.

---

## 2. The 3-Layer AI Agent Testing Pyramid

AquaBot explicitly avoids the **"Inverted Pyramid" anti-pattern** (using expensive, flaky LLM judges for checks that deterministic code or mocked trajectories verify in milliseconds):

```text
          /\
         /  \        Layer 3: Live Edge DeepEval, G-Eval & Red-Teaming
        /----\       (Real Edge + Gemini: parallel carts, multilingual chips, RAG faithfulness)
       /      \
      /--------\     Layer 2: Scripted-Trajectory, Loop/RAG Lifecycle & Playwright E2E
     /          \    (Mock D1/Vectorize/Gateway + real Chromium Shadow DOM E2E)
    /------------\
   /              \  Layer 1: Deterministic Unit, Streaming & Security
  ------------------ ($0 cost, ms: formulas, sliding-tail <quick_replies>, HMAC, SSRF, auth)
```

### Layer 1 — Deterministic Unit, Streaming & Security (`$0` Cost, Milliseconds)
* Verifies engineering math formulas, multi-byte UTF-8 SSE splitting, `thoughtSignature` preservation across parallel `functionCalls[]`, defensive sliding-tail `<quick_replies>` filtering (including partial chunks and inline `<` math expressions), fail-closed `X-Admin-Key`, `HMAC-SHA256` webhook validation, hex color validation, SSRF guards, and R2 `sandbox` CSP headers.

### Layer 2 — Scripted-Trajectory, Data/RAG Lifecycle & Playwright E2E (Pre-Deploy Gate)
* **Agent Loop & Trajectory:** Tests parallel `search_catalog` + sequential `update_cart`, round-robin `single_products` merging, legacy history normalization, `(tool, args)` Loop Detector (`seenCount > 2`), `maxSteps` tool-free graceful wrap-up, and respect for explicit negative WhatsApp opt-outs.
* **Vectorize & Tenant Lifecycle:** Verifies `1 -> 0` stock batch Vectorize purge & hash reset, `0 -> 1` re-embedding, strict empty custom tenant isolation (`0` leakage from `default`), `raw_payload` upsert preservation, single-query `/shops` aggregation (no `N+1`), and SQL-aggregated funnel revenue.
* **Playwright Chromium Widget E2E:** Launches the real compiled Preact Shadow DOM bundle in Chromium to verify streaming status pills, abort-on-reset, mobile layout overflow bounds, dynamic white-label CSS variables (`primary_color`, `welcome_message`), domain-isolated `localStorage` sessions, real HTTP `422` cart error handling (never faking cart success), and non-Shopify event-only dispatch safety.

### Layer 3 — Live Edge DeepEval / G-Eval & Red-Teaming (Post-Deploy Gate)
* Evaluates end-to-end live Edge behavior using **DeepEval** (`SingleTurnParams`):
  * **RAG-enabled turns:** `ContextualRelevancyMetric`, `FaithfulnessMetric`, and `GEval` (`INPUT`, `ACTUAL_OUTPUT`, `RETRIEVAL_CONTEXT`) + `tools_called` checks across semantic symptoms, price sorting, multi-turn revisions, variant-accurate parallel carts, and TR/EN/DE multilingual `<quick_replies>`.
  * **Non-RAG turns:** `tools_called` + `GEval` (`INPUT`, `ACTUAL_OUTPUT` without `RETRIEVAL_CONTEXT`) covering negative WhatsApp preferences, empty-tenant honesty, direct WhatsApp handoff, non-domain image rejection, and adversarial prompt-injection red-teaming.
* **Rate-Limit-Resilient Eval Judge:** The live evaluation adapter isolates async execution behind hard HTTP/thread timeouts (preventing event-loop deadlocks) and applies inter-call pacing plus server `retryDelay`-aware backoff for strict free-tier API quotas.
