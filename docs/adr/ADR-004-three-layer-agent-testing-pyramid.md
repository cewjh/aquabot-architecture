# ADR-004: Three-Layer AI Agent Testing Pyramid

* **Status:** Accepted
* **Context:** Relying solely on LLM-as-a-Judge tests for every code change creates an "inverted testing pyramid"—slow, non-deterministic, and expensive CI runs—while unit-testing only helper functions misses tool-routing regressions and hallucinations.
* **Decision:** Enforce a **3-Layer AI Testing Pyramid**:
  1. **Layer 1 (`$0`, ms):** Deterministic unit, math, UTF-8 streaming, and security/HMAC tests.
  2. **Layer 2 (Pre-Deploy Gate):** Scripted-Trajectory integration tests against mocked D1/R2 and a stubbed LLM gateway to verify tool selection, `sort_by` Vector Bypass (`embedCallCount == 0`), and cart state mutations.
  3. **Layer 3 (Quality Gate):** Live DeepEval (`ToolCorrectnessMetric`, `FaithfulnessMetric`, `ContextualRelevancyMetric`, `GEval`) and adversarial red-teaming, strictly separating RAG-enabled vs. non-RAG test cases.
* **Alternatives Considered:**
  1. *End-to-End LLM Evals Only:* High API cost, flaky CI, slow feedback loop.
  2. *Manual QA Only:* Unsafe for multi-turn tool trajectories and prompt regressions.
* **Consequences & Trade-offs:**
  * **Pros:** Fast developer feedback loop, deterministic regression guards for agent trajectories, and targeted LLM eval spend only where semantic judgment is genuinely needed.
  * **Cons:** Requires maintaining mock gateway fixtures alongside real DeepEval scenarios.
