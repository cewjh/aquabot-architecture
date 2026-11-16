# ADR-002: Framework-less Native ReAct Agent Loop Instead of Agent Frameworks

* **Status:** Accepted
* **Context:** Many LLM applications adopt heavy orchestration frameworks (e.g., LangChain, LlamaIndex) for tool calling and memory. On Cloudflare V8 Workers, bundle size, memory footprint, and fine-grained control over streaming SSE protocols are critical constraints.
* **Decision:** Implement a **framework-less Native ReAct Agent Loop** directly on top of the LLM's native `functionCall` / `functionResponse` and `responseSchema` APIs using Web-Standard `TransformStream`s.
* **Alternatives Considered:**
  1. *JS/TS Agent Frameworks:* Abstract away raw model payloads, making it harder to preserve provider-specific fields like `thoughtSignature` across multi-turn tool calls and adding unnecessary bundle weight.
  2. *Single-shot Prompting without Tools:* Fast, but prone to arithmetic and pricing hallucinations.
* **Consequences & Trade-offs:**
  * **Pros:** Full control over 3-stage execution (Tool Decision $\rightarrow$ Non-streamed Structured JSON Selection $\rightarrow$ Streamed Synthesis), exact `thoughtSignature` preservation in `rawParts`, ephemeral UI `status` events, and minimal bundle overhead.
  * **Cons:** Requires maintaining custom SSE chunk parsers and multi-byte UTF-8 boundary handling, mitigated by Layer 1 deterministic streaming unit tests.
