# ADR-002: Framework-less Native ReAct Agent Loop Instead of Agent Frameworks

* **Status:** Accepted
* **Context:** Heavy LLM orchestration frameworks add substantial bundle weight, opaque prompt mutations, and abstraction layers that obscure provider-specific tool-calling payloads (such as reasoning `thoughtSignature` tokens) and degrade fine-grained SSE streaming control inside Cloudflare V8 isolates.
* **Decision:** Implement a **framework-less, provider-agnostic Bounded Native ReAct Agent Loop** directly on top of the model's native `functionCall` / `functionResponse` APIs using Web-Standard `TransformStream` and `ReadableStream`, backed by a declarative Read/Write **Tool Registry**.
* **Alternatives Considered:**
  1. *JS/TS Agent Frameworks (LangChain / LlamaIndex JS):* Accelerate initial prototyping, but strip or alter raw `thoughtSignature` parts during multi-step tool replay and inflate Worker bundle size.
  2. *Multi-Stage Chained JSON Selectors:* Calling a secondary non-streamed LLM solely to pick SKUs doubles round-trip latency, duplicates prompt/catalog tokens, and breaks conversational continuity.
* **Consequences & Trade-offs:**
  * **Pros:** Full control over `rawParts` replay, parallel `Promise.all` read dispatch vs. serialized writes, exact token/budget accounting per turn, and minimal edge bundle footprint.
  * **Cons:** Requires maintaining custom SSE chunk decoders, sliding-tail stream filters, and multi-byte UTF-8 boundary handling—mitigated by deterministic Layer 1 streaming unit tests (`references/tests/streaming_and_connectors.test.mjs`).
