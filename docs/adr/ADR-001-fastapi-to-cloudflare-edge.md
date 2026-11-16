# ADR-001: Migrating from Python/FastAPI to Cloudflare V8 Edge Workers

* **Status:** Accepted
* **Context:** AquaBot began as a local Python/FastAPI service backed by SQLAlchemy/SQLite. For an embeddable e-commerce widget serving global storefronts, container-based hosting introduces cold-start latency, regional round-trip overhead, and higher baseline infrastructure cost.
* **Decision:** Migrate the production API, agent orchestrator, and widget delivery to **Cloudflare V8 Edge Workers** with **Cloudflare D1** (edge SQLite) and **Cloudflare R2** (object storage), keeping the FastAPI codebase strictly as a local reference/eval harness.
* **Alternatives Considered:**
  1. *Dockerized FastAPI on a single-region VPS / Cloud Run:* Simpler Python ecosystem, but suffers from cold starts or idle container costs and higher TTFB for distant storefronts.
  2. *Edge API proxy + Origin FastAPI:* Adds an extra network hop and dual-deployment complexity.
* **Consequences & Trade-offs:**
  * **Pros:** `0ms` cold-start across 300+ PoPs, `<2ms` local D1 reads, built-in `ctx.waitUntil()` for zero-latency telemetry, and single-bundle asset serving.
  * **Cons:** No Node.js/Python runtime APIs in V8 isolates; all SSE parsing, HMAC verification, and ReAct orchestration must be written against Web Standards (`fetch`, `TransformStream`, `Web Crypto API`).
