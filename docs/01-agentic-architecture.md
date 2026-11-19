# 01 — Agentic Architecture & Streaming Orchestration

AquaBot runs a **modular, framework-less Bounded Native ReAct (Reasoning + Acting) Agent Loop** at the Cloudflare edge. Rather than chaining disconnected LLM calls with hidden intermediate JSON selectors, a single reasoning model drives a declarative **Tool Registry** with strict loop safety, parallel read execution, and single-point streaming synthesis.

---

## 1. Single-Brain Bounded Native ReAct Flow

When a user sends a message (or uploads an aquarium photo), the Edge Worker invokes the generic Bounded ReAct Orchestrator backed by the domain's declarative Read/Write Tool Registry:

```mermaid
sequenceDiagram
    autonumber
    participant U as Widget (Preact + SSE)
    participant W as Bounded ReAct Worker
    participant R as Tool Registry (Read/Write)
    participant D as D1 / Vectorize / R2
    participant L as Multimodal LLM

    U->>W: POST /api/v1/chat (Accept: text/event-stream)
    W->>D: Load tenant config, active specs & session history
    loop Bounded Loop (step < maxSteps & spent < turnBudget)
        W->>L: Streamed call with declared Tools + history
        alt Model emits functionCalls[]
            W-->>U: SSE status (batched parallel/tool status)
            par Read-Only Tools (Promise.all)
                W->>R: Dispatch search_catalog / calculate_specs concurrently
                R->>D: Execute deterministic physics or Vectorize/D1 search
            end
            opt Write Tools (Serialized)
                W->>R: Execute create_cart_bundle / modify_cart / handoff_to_whatsapp sequentially
                R->>D: Verify SKUs, stock, explicit variants & assemble cart state
            end
            W->>W: Loop Detector & Payload Cap -> append rawParts + functionResponses
        else Final Text Answer
            L-->>W: Streamed grounded synthesis + trailing <quick_replies>
            W-->>U: Sliding-tail SSE delta (tags stripped in flight)
        end
    end
    opt Step or Budget Ceiling Reached
        W->>L: Graceful Wrap-Up (tools: disabled)
        W-->>U: Stream final summary response
    end
    Note over W,D: ctx.waitUntil() persists session, multi-step Langfuse spans & cost
```

### Key Architectural Properties
1. **Single-Brain Grounded Context:** Retiring the legacy secondary JSON-selection LLM eliminated double inference latency, context split-brain errors, and category mismatches. The same model that inspects user photos and reasons over calculations also inspects retrieved SKUs and invokes verified cart mutations directly.
2. **Parallel Read / Serialized Write Dispatch & Schema-Level Thought Slots:** When a turn requires multiple independent catalog lookups (e.g., substrate + canister filter + heater + lighting), the model emits parallel `functionCall` parts in a single turn. The Tool Registry runs `mode: "read"` tools concurrently via `Promise.all` and `mode: "write"` tools strictly sequentially to preserve cart consistency. Round-robin merging ensures single-product suggestion shelves represent every queried category evenly. Placing a leading `intent` field inside search tool parameter schemas acts as a **Schema-Level Thought Slot**, anchoring assumptions and user intent prior to emitting query terms.
3. **Static 5-Tool ACI & KV-Cache Prefix Stability (`AUTO` Mode):**
   * The Agent-Computer Interface exposes 5 focused, shallow tools defined with standard JSON Schema (`parametersJsonSchema`, `additionalProperties: false`, explicit `required` and `enum` fields): `calculate_aquarium_specs`, `search_catalog`, `create_cart_bundle` (clean initial basket assembly), `modify_cart` (incremental `add`, `remove`, `set_quantity`, `replace`, `clear`), and `handoff_to_whatsapp`.
   * Rather than toggling declaration subsets mid-loop (which breaks prompt-prefix KV caching and creates historical schema mismatches) or applying forced grammar lockups over nested arrays, the loop keeps the tool prefix strictly static across every step in native `AUTO` mode.
4. **Fail-Loud Self-Correcting Tool Boundaries:**
   * Rather than guessing or silently downgrading explicit `variant_id` arguments on mismatch, backend cart builders fail loudly—returning `invalid_variant_id` (or `variant_out_of_stock`) along with the verified `available_variants` list so the ReAct loop self-corrects cleanly on the next step.
   * Incremental `replace` mutations validate replacement SKUs and variants before removing existing basket entries (atomic swap), and empty-cart edits cleanly direct the loop to `create_cart_bundle`.
5. **Bounded Execution & Loop Circuit Breaker:**
   * Enforces dual ceilings: `maxSteps = 8` and a per-turn FinOps spend cap.
   * Tracks `(toolName, stableStringify(args))` signatures per turn; repeating an identical signature beyond threshold (`> 2`) injects a `loop_detected` feedback payload instead of failing or looping endlessly.
   * If a ceiling is reached without a final answer, the loop performs a tool-free (`tools: disabled`) synthesis pass so the user still receives a coherent response.
6. **Zero-Extra-Cost Contextual `<quick_replies>`:** Instead of serving static Turkish buttons or paying for a second LLM call to generate follow-up chips, the agent appends `<quick_replies>[...]</quick_replies>` at the end of its synthesis in the user's exact conversation language. A stateful sliding-tail SSE stream filter withholds potential partial tags at chunk boundaries so raw XML/JSON tags never flicker in the UI, then delivers the parsed array in the `final` event.

---

## 2. Multi-Turn Protocol Integrity (`thoughtSignature` & Canonical Trajectory)

Modern reasoning models attach encrypted/opaque `thoughtSignature` tokens inside `functionCall` response parts.
* **Verbatim `rawParts` Replay:** During a multi-step turn, the Edge Worker appends `res.rawParts` verbatim alongside 1-to-1 `functionResponse` entries so tool-use stability and reasoning alignment never degrade.
* **Canonical `Read -> Write -> Synthesize` History Reconstruction:** Persisted conversation turns containing prior bundles or single-product recommendations are reconstructed into canonical `search_catalog` (`functionCall` $\rightarrow$ `functionResponse`) $\rightarrow$ `create_cart_bundle` / `modify_cart` $\rightarrow$ `model text` causal sequences (with automatic normalization of legacy tool identifiers into current active declarations), keeping exact product/variant IDs and read-before-write demonstrations intact for follow-up cart edits.
* Ephemeral UI `status` events remain strictly transient and are never persisted into `chat_sessions`.

---

## 3. Resilient Error & Quota Handling

* **Clean Transient Fallbacks:** If the upstream LLM gateway fails transiently, the Worker **never** fabricates synthetic equipment lists or locks the session (`is_finalized`). Instead, it preserves existing session state and offers a direct support card.
* **Quota-Locked Sessions:** Once a session genuinely crosses its configured FinOps budget, subsequent messages execute at `$0.00` LLM cost—returning any existing verified bundle or a clean expert handoff card.
* **Disconnect Resilience (`ctx.waitUntil`):** Aborting or closing the browser mid-stream still finalizes session state persistence, token cost accounting, and multi-step `edge_gemini_step_N` OpenTelemetry spans to Langfuse asynchronously.
