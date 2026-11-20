# ADR-001: Edge Runtime Architecture on Cloudflare V8 Workers

* **Status:** Accepted
* **Context:** Serving an embeddable e-commerce AI assistant and multi-tenant control plane to global storefronts requires low Time-To-First-Byte (TTFB), predictable latency across regions, and minimal idle infrastructure overhead. Traditional containerized Python/FastAPI deployments introduce cold-start penalties, regional round-trip hops, and continuous container billing.
* **Decision:** Execute the production Data Plane API, Bounded ReAct orchestrator, Merchant Portal, Control Plane, and widget bundle delivery directly on **Cloudflare V8 Edge Workers** backed by **Cloudflare D1** (edge SQLite), **Cloudflare Vectorize**, and **Cloudflare R2** (object storage). Domain-specific local evaluation harnesses remain in Python (`pytest` + DeepEval).
* **Alternatives Considered:**
  1. *Dockerized FastAPI on Single-Region Containers:* Rich Python ecosystem, but incurs cold starts or always-on compute costs and higher TTFB for geographically distributed storefronts.
  2. *Edge Reverse Proxy + Origin Backend:* Adds an extra network hop and dual-deployment operational surface.
* **Consequences & Trade-offs:**
  * **Pros:** `0ms` cold starts across edge PoPs, `<2ms` local D1 metadata reads, native `ctx.waitUntil()` for non-blocking telemetry and Langfuse spans, and zero-dependency asset serving.
  * **Cons:** V8 isolates prohibit Node.js-only/Python runtime APIs; SSE stream parsing, Web Crypto PBKDF2/HMAC/JWKS verification, SSRF guards, and XML ingestion must be built strictly on WinterTC Web Standards (`fetch`, `TransformStream`, `ReadableStream`, `crypto.subtle`).
