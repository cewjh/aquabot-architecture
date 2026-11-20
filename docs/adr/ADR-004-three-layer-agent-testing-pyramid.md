# ADR-004: Three-Layer AI Agent Testing Pyramid

* **Status:** Accepted
* **Context:** Relying solely on LLM-as-a-Judge evaluations for every code change creates an "inverted testing pyramid"—slow, non-deterministic, and costly CI runs—while unit-testing only helper functions misses tool-routing regressions, KV-cache prefix drift, and cart-mutation hallucinations.
* **Decision:** Enforce a **3-Layer AI Agent Testing Pyramid**:
  1. **Layer 1 (`$0`, ms):** Deterministic unit, math, UTF-8 streaming, SSRF, Web Crypto auth, and connector parsing tests.
  2. **Layer 2 (Pre-Deploy Gate):** Scripted-Trajectory integration tests against mocked D1/Vectorize/R2 and a stubbed LLM gateway verifying parallel tool selection, `sort_by` Vector Bypass (`embedCallCount == 0`), fail-loud variant self-correction, and headless Chromium Playwright Shadow DOM E2E behavior.
  3. **Layer 3 (Post-Deploy Quality Gate):** Live Edge DeepEval (`ToolCorrectnessMetric`, `FaithfulnessMetric`, `ContextualRelevancyMetric`, `GEval`) and adversarial prompt-injection red-teaming coordinated by a file-locked bounded-parallel rate queue, strictly separating RAG-enabled vs. non-RAG test suites.
* **Alternatives Considered:**
  1. *End-to-End LLM Evals Only:* High API cost, flaky CI, slow developer feedback loop.
  2. *Manual QA Only:* Unsafe for multi-turn tool trajectories, variant boundaries, and prompt regressions.
* **Consequences & Trade-offs:**
  * **Pros:** Instant `$0` regression feedback in CI, deterministic verification of agent trajectories and security boundaries, and targeted LLM eval spend only where semantic judgment is genuinely required.
  * **Cons:** Requires maintaining deterministic mock gateway fixtures alongside live DeepEval benchmark scenarios.
