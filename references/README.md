# Sanitized Architecture Reference Modules

This directory contains **zero-dependency, Web-Standards-compliant reference implementations** extracted from the core architectural patterns of Commerce Copilot. They run directly on Node.js (`>=20`) or Cloudflare Workers without external npm dependencies.

> **Privacy & IP Boundary:** Proprietary system prompts, domain-specific physics coefficients, tenant catalogs, and live deployment identifiers remain private. These modules demonstrate the exact **engineering contracts, security guards, cryptographic primitives, and agentic control loops** documented in [`../docs/`](../docs/).

## Modules Included

| Module | Architectural Responsibility | Related Docs / ADRs |
| :--- | :--- | :--- |
| [`src/core/ssrf.mjs`](src/core/ssrf.mjs) | HTTPS-only validation, RFC1918/IPv6/cloud-metadata IP blocking, manual 3xx redirect hop validation, and byte-capped remote fetch | [03-universal-connectors-and-ssrf.md](../docs/03-universal-connectors-and-ssrf.md), [ADR-008](../docs/adr/ADR-008-universal-connectors-and-ssrf-boundary.md) |
| [`src/core/webcrypto_auth.mjs`](src/core/webcrypto_auth.mjs) | Constant-time string comparison, PBKDF2-SHA256 (`100k` iterations) password hashing, HMAC-SHA256 session cookies, SHA-256 token hashing, and Zero Trust RS256 JWKS verification | [04-control-plane-and-finops.md](../docs/04-control-plane-and-finops.md), [05-merchant-portal-and-onboarding.md](../docs/05-merchant-portal-and-onboarding.md), [ADR-009](../docs/adr/ADR-009-edge-native-webcrypto-merchant-auth.md) |
| [`src/agent/loop_detector.mjs`](src/agent/loop_detector.mjs) | Deterministic key-sorted JSON canonicalization and `(toolName, normalizedArgs)` loop circuit breaker | [01-agentic-architecture.md](../docs/01-agentic-architecture.md) |
| [`src/agent/registry_and_loop.mjs`](src/agent/registry_and_loop.mjs) | Provider-agnostic Bounded ReAct loop with static ACI prefix invariance, concurrent `Promise.all` reads, serialized writes, dual step/budget ceilings, and tool-free graceful wrap-up | [01-agentic-architecture.md](../docs/01-agentic-architecture.md), [ADR-006](../docs/adr/ADR-006-single-brain-parallel-react-loop.md) |
| [`src/cart/cart_mutation.mjs`](src/cart/cart_mutation.mjs) | Fail-loud explicit `variant_id` validation (never silently falling back to `variants[0]`), bundle construction, and atomic `replace` cart mutations | [01-agentic-architecture.md](../docs/01-agentic-architecture.md), [ADR-006](../docs/adr/ADR-006-single-brain-parallel-react-loop.md) |
| [`src/streaming/sse_filter.mjs`](src/streaming/sse_filter.mjs) | Multi-byte UTF-8 SSE block parser, `thoughtSignature` verbatim collector, and zero-flicker sliding-tail `<quick_replies>` stream extractor | [01-agentic-architecture.md](../docs/01-agentic-architecture.md) |
| [`src/connectors/platform_detect.mjs`](src/connectors/platform_detect.mjs) | SSRF-guarded multi-layer storefront fingerprinting (`Shopify`, `WooCommerce`, `ikas`, `Ticimax`, `T-Soft`) and feed/sitemap discovery | [03-universal-connectors-and-ssrf.md](../docs/03-universal-connectors-and-ssrf.md), [05-merchant-portal-and-onboarding.md](../docs/05-merchant-portal-and-onboarding.md) |

## Running the Test Suite

```bash
cd references
npm test
```
