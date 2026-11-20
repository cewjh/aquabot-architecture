# AI Engineering, Guardrails & 3-Layer Evaluation Pyramid (`EVALS.md`)

Reliable production AI agents require separating deterministic engineering invariants from semantic LLM judgment. Commerce Copilot and its domain vertical AquaBot enforce a **Zero-Hallucination Policy** verified by a **3-Layer AI Testing Pyramid** plus headless Chromium Shadow DOM E2E testing.

---

## 1. Cognitive Guardrails & Zero-Hallucination Boundaries

1. **Deterministic Calculations & Pricing:** Inventory pricing, variant availability, cart line totals, and domain-specific physics specs (`calculate_aquarium_specs` in the AquaBot vertical) are computed deterministically in application code—never guessed by an LLM.
2. **Intent-Driven Cognitive Boundaries (Zero Lexical Blacklists):** Instead of brittle negative phrase blacklists (*"Pink Elephant" anti-patterns*), system behavior relies on **Semantic Intent Decision Boundaries**, positive goal framing, and a **Causal State-Reality Contract** (responses only claim cart/tool mutations backed by verified tool outputs in the active turn or persisted session state).
3. **Fail-Loud Variant Validation:** Explicit `variant_id` arguments never silently downgrade to `variants[0]`. Invalid or out-of-stock selections fail loudly (`invalid_variant_id` / `variant_out_of_stock` + `available_variants[]`) so the ReAct loop self-corrects within the same turn.
4. **Zero Pre-Tool Prose & Language Alignment:** Tool-requiring turns invoke `search_catalog` / `compare_products` / `create_cart_bundle` directly without premature prose, and `<quick_replies>` mirror the shopper's conversation language.
5. **Empty-Catalog Honesty:** Custom tenants with zero synced SKUs receive `catalog_empty` rather than silently leaking shared demo inventory.

---

## 2. The 3-Layer AI Testing Pyramid

Commerce Copilot avoids the **"Inverted Pyramid" anti-pattern** (paying slow, flaky LLM-as-a-Judge costs for invariants that deterministic tests verify in milliseconds):

```text
          /\
         /  \        Layer 3: Live Edge DeepEval, G-Eval & Red-Teaming
        /----\       (Multi-sector + vertical live Edge: RAG faithfulness, tool accuracy)
       /      \
      /--------\     Layer 2: Scripted-Trajectory, Connector/Portal & Playwright E2E
     /          \    (Mock D1/Vectorize/Gateway + headless Chromium Shadow DOM E2E)
    /------------\
   /              \  Layer 1: Deterministic Unit, Streaming, Auth & SSRF
  ------------------ ($0 cost, ms: SSRF, PBKDF2/HMAC/JWT, sliding-tail SSE, cart engine)
```

### Layer 1 — Deterministic Unit, Streaming & Security (`$0` Cost, Milliseconds)
*(Implemented and executed in CI via [`references/tests/`](references/tests/))*
* **SSRF & Connector Parsing:** Validates HTTPS-only enforcement, IPv4/IPv6/WHATWG-hex metadata blocking, manual 3xx redirect hop validation, RSS 2.0/Atom XML parsing (`<g:item_group_id>`), and 5-platform storefront fingerprinting.
* **Web Crypto Security:** Verifies `100k`-iteration PBKDF2-SHA256, HMAC session cookie tamper/expiry rejection, SHA-256 token digests, and Cloudflare Zero Trust `RSASSA-PKCS1-v1_5` JWKS verification.
* **Streaming & Cart Determinism:** Verifies multi-byte UTF-8 SSE splitting, `thoughtSignature` verbatim preservation, defensive sliding-tail `<quick_replies>` stripping (including inline `<` math expressions), and fail-loud cart mutations.

### Layer 2 — Scripted-Trajectory, Tenant Lifecycle & Playwright Chromium E2E
* **Agent Loop & Trajectory:** Tests parallel `search_catalog` + serialized `create_cart_bundle` / `modify_cart`, static ACI prefix invariance (KV-cache safety in native `AUTO` mode), same-turn invalid-variant self-correction, atomic `replace`, `sort_by` SQL Vector Bypass (`embedCallCount == 0`), `(tool, args)` Loop Detector (`seenCount > 2`), and `maxSteps` tool-free graceful wrap-up.
* **Vectorize & Tenant Lifecycle:** Verifies `1 -> 0` stock batch Vectorize purge (`20` IDs/batch), `0 -> 1` re-embedding, zero cross-tenant catalog leakage (`403` isolation on Merchant Portal APIs), and privilege-escalation prevention (`plan_id` immutability on merchant settings).
* **Playwright Headless Browser E2E:** Mounts the compiled Preact Shadow DOM widget and Control/Merchant dashboards in Chromium—asserting `0` horizontal overflow on `375px` mobile viewports, dynamic `color-mix()` header darkening, live `postMessage` config previews, real HTTP `422` Shopify cart error surfacing, and all Admin FinOps tabs.

### Layer 3 — Live Edge DeepEval / G-Eval & Red-Teaming (Post-Deploy Gate)
* Evaluates end-to-end live Edge behavior across **multi-sector retail scenarios** (Fashion outfit combos, Electronics side-by-side comparisons, Cosmetics routines, Store Knowledge shipping/refund RAG, empty-tenant honesty, prompt-injection red-teaming) plus the **32-scenario AquaBot vertical benchmark**.
* **Metrics:** `FaithfulnessMetric`, `ContextualRelevancyMetric`, `GEval` (`INPUT`, `ACTUAL_OUTPUT`, `RETRIEVAL_CONTEXT` for RAG turns; `INPUT`, `ACTUAL_OUTPUT` for non-RAG turns), and deterministic `tools_called` trajectory assertions.
* **Bounded-Parallel Cross-Process Rate Queue (`CrossProcessRateQueue`):** Coordinates parallel `pytest -n 2` workers using an OS file-locked epoch-time token queue (`max_concurrency=2`) with stale-slot TTL recovery, exponential backoff on upstream `5xx`/gateway spikes, and `retryDelay`-aware judge pacing.
