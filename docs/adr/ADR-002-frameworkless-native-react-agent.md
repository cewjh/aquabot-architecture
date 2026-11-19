# ADR-002: Framework-less Native ReAct Agent Loop Instead of Agent Frameworks

* **Status:** Accepted
* **Context:** Many LLM applications adopt heavy orchestration frameworks (e.g., LangChain, LlamaIndex) for tool calling and memory. On Cloudflare V8 Workers, bundle size, memory footprint, and fine-grained control over streaming SSE protocols are critical constraints.
* **Decision:** Implement a **framework-less Native ReAct Agent Loop** directly on top of the LLM's native `functionCall` / `functionResponse` and `responseSchema` APIs using Web-Standard `TransformStream`s.
* **Alternatives Considered:**
  1. *JS/TS Agent Frameworks:* Abstract away raw model payloads, making it harder to preserve provider-specific fields like `thoughtSignature` across multi-turn tool calls and adding unnecessary bundle weight.
  2. *Single-shot Prompting without Tools:* Fast, but prone to arithmetic and pricing hallucinations.
* **Consequences & Trade-offs:**
  * **Pros:** Full control over multi-step ReAct execution, exact `thoughtSignature` preservation in `rawParts`, ephemeral UI `status` events, and minimal bundle overhead.
  * **Cons:** Requires maintaining custom SSE chunk parsers, stream filters, and multi-byte UTF-8 boundary handling, mitigated by Layer 1 deterministic streaming unit tests.

## Amendment (v2 — Single-Brain Parallel Bounded ReAct Loop)
* **Superseding Detail:** The initial 3-stage pipeline (which delegated bundle item picking to a separate non-streamed `responseSchema` JSON call) has been superseded by a **single-brain Bounded ReAct Loop** (`maxSteps`, per-turn budget cap, `(tool, args)` loop circuit breaker, tool-free wrap-up) backed by a generic Read/Write **Tool Registry** with parallel read execution and single-point sliding-tail SSE streaming. See [ADR-006](ADR-006-single-brain-parallel-react-loop.md).
