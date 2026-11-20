# 06 — Vertical Case Study: AquaBot (Domain-Calibrated Aquascaping Assistant)

The core agentic architecture powering Commerce Copilot originated in **AquaBot**, a specialized AI sales and domain-engineering assistant built for **aquascaping and aquarium hardware e-commerce**. While Commerce Copilot generalizes the platform across arbitrary retail verticals, AquaBot demonstrates how the exact same Bounded ReAct + Vectorize SSOT + 3-Layer Testing Pyramid adapts to **safety-critical, math-intensive product domains**.

---

## 1. Extending the Static ACI for Deterministic Domain Physics

In specialized hardware domains, LLMs frequently hallucinate volume conversions, electrical wattage, flow-rate multipliers, or structural glass tolerances. AquaBot eliminates this failure mode by registering a deterministic engineering tool (`calculate_aquarium_specs`) alongside the standard catalog/cart tools:

| Parameter / Calculation | Computed Deterministically in Code |
| :--- | :--- |
| **Tank Volume & Water Weight** | Gross and net displacement (`L`), substrate displacement deduction, total wet weight (`kg`) |
| **Structural Safety** | Glass thickness (`mm`) recommendations and safety-factor bounds based on height/span |
| **Filtration & Heating** | Target canister circulation (`L/h` turnover) and heater wattage (`W`) scaled by ambient delta |
| **Lighting & Aquascape** | Target lumen/PAR brackets (`low` / `medium` / `high` tech) and sloped substrate volume (`L`) |

The LLM **never guesses** engineering numbers; it passes structured tank parameters into `calculate_aquarium_specs`, receives verified technical targets, and executes parallel `search_catalog` calls filtered by `min_flow_lph`, `min_watt`, or `min_lumen` attributes before assembling a compatible multi-item setup bundle.

---

## 2. Multimodal Vision Pipeline (Cloudflare R2 + Vision Analysis)

Storefront visitors can upload photos of existing aquariums or algae/equipment issues:
1. Uploaded images are validated via magic-byte inspection (PNG/JPEG/WebP), persisted in **Cloudflare R2**, and served through a hardened proxy with `X-Content-Type-Options: nosniff` and a strict `sandbox` Content-Security-Policy.
2. Within the **single-brain ReAct context**, the multimodal model inspects the image directly—diagnosing plant/algae conditions or tank proportions—then searches verified inventory and builds a grounded remedy or hardware bundle in the same turn without context handoff loss.

---

## 3. Vertical Evaluation Benchmark (32 DeepEval Scenarios)

Because incorrect wattage, incompatible filter flow, or phantom cart claims carry high customer-return risk, AquaBot enforces a **32-scenario vertical DeepEval gate** on top of Layer 1 (`$0` math/streaming/security) and Layer 2 (scripted trajectory + Chromium Shadow DOM E2E) tests:

* **RAG-Enabled Turns (`ContextualRelevancyMetric`, `FaithfulnessMetric`, `GEval`):** Semantic algae/symptom diagnosis, deterministic price sorting (`embedCallCount == 0`), variant-accurate parallel equipment bundles, delegated sizing ("build a 60cm planted tank kit" with transparent assumption disclosure), and TR/EN/DE `<quick_replies>` alignment.
* **Non-RAG & Safety Turns (`tools_called` + `GEval`):** Respecting negative WhatsApp opt-outs, honest empty-catalog reporting (`0` leakage from shared demo inventory), off-topic image rejection, and adversarial prompt-injection red-teaming.

---

## 4. Architectural Lessons Carried Into Commerce Copilot

1. **Keep the Core Loop Domain-Agnostic:** Separating `agent/react_loop.mjs` from `domain/*` allowed AquaBot's battle-tested ReAct loop, fail-loud `cart_mutation.mjs`, and Vectorize SSOT to generalize into multi-sector retail (`fashion`, `electronics`, `cosmetics`, `sports`) with zero orchestrator rewrites.
2. **Replace Domain Heuristics with Universal Knowledge RAG:** Customer policy questions (shipping, warranty, sizing guides) mirrored aquascaping FAQs; unifying product vectors and policy vectors inside a single Vectorize index (`doc_type: "product" | "knowledge"`) eliminated bespoke FAQ handlers.
3. **Self-Service Onboarding Is Essential Beyond Single-Niche Pilots:** Scaling beyond custom Shopify builds required automated storefront fingerprinting (`platform_detect.mjs`), SSRF-guarded XML ingestion, and a merchant portal (`/dashboard`) with live `postMessage` preview.
