# ADR-009: Edge-Native Web Crypto Merchant Auth & Decoupled Store Claim Flow

* **Status:** Accepted
* **Context:** Self-service merchant onboarding (`/dashboard`) requires secure authentication, multi-store agency support, and frictionless handover of operator-provisioned stores to store owners—without introducing per-MAU external auth SaaS fees or external identity latency on every Worker invocation.
* **Decision:**
  1. **Zero-Dependency Web Crypto Auth:** Hash passwords natively via `crypto.subtle` PBKDF2-SHA256 (`100,000` iterations, 16-byte cryptographic salt) with constant-time comparison, and issue HMAC-SHA256 signed `HttpOnly; SameSite=Lax` session cookies.
  2. **Identity & Store Decoupling (`merchant_users` ↔ `shop_members` ↔ `shops`):** Separate user accounts from store records via a many-to-many membership table (`owner`, `admin`, `editor`) and enforce strict field whitelists on merchant settings endpoints so merchants cannot escalate `plan_id` or FinOps budgets.
  3. **Single-Use Hashed `claim_token` Handover:** Operators generate pre-configured store invite links whose raw secret is returned once and stored strictly as a SHA-256 hex digest in `shop_claim_tokens`.
* **Alternatives Considered:**
  1. *Managed Auth SaaS (Auth0 / Clerk):* Faster UI scaffolding, but adds per-MAU billing, external JWKS network hops, and extra synchronization state for Shopify/admin store handovers.
  2. *Store-Scoped Shared Passwords:* Prevents multi-store agency management and complicates credential rotation.
* **Consequences & Trade-offs:**
  * **Pros:** `$0` per-MAU cost, `0` external auth dependencies, seamless 3-path onboarding (admin claim token, self-service domain registration with `409 Conflict` guard, Shopify OAuth auto-bind), and verified privilege-escalation isolation.
  * **Cons:** Requires careful Web Crypto implementation and automated security tests covering PBKDF2, HMAC tampering, token expiry, and cross-tenant isolation (`403`).
