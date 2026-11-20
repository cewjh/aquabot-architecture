# 00 — C4 Architecture, Three-Plane Topology & Multi-Tenant Data Model

**Commerce Copilot** is a multi-tenant, domain-agnostic AI shopping assistant and SaaS FinOps platform built natively on **Cloudflare V8 Edge Workers**. The architecture separates storefront customer inference (**Data Plane**), tenant onboarding and live preview (**Tenant Self-Service Plane**), and platform unit-economics governance (**Control Plane**) over a strictly isolated **Cloudflare D1**, **Vectorize**, and **R2** storage foundation.

---

## 1. C4 Level 1 — System Context

```mermaid
C4Context
    title C4 Level 1 — Commerce Copilot System Context

    Person(shopper, "Storefront Visitor", "Chats via natural language or product/room photos and adds verified variants to cart")
    Person(merchant, "Store Owner / Merchant", "Onboards store, configures brand tone, manages knowledge RAG, and embeds widget")
    Person(operator, "Platform Operator", "Governs plans, FinOps budgets, active LLM models, and tenant quotas")

    System(copilot, "Commerce Copilot SaaS", "Multi-tenant Edge AI shopping assistant, catalog RAG engine, and FinOps control plane")

    System_Ext(storefront, "Merchant Storefront", "Shopify, WooCommerce, ikas, Ticimax, T-Soft, or Custom Headless")
    System_Ext(aigw, "Cloudflare AI Gateway + LLM", "Multimodal generation, parallel tool calling, and 768d text embeddings")
    System_Ext(langfuse, "Langfuse (OTel)", "Asynchronous multi-step trace spans and latency/cost telemetry")

    Rel(shopper, copilot, "Streams SSE chat & uploads vision images", "HTTPS / Shadow DOM")
    Rel(merchant, copilot, "Authenticates, detects platform, syncs feeds & previews widget", "HTTPS / Web Crypto")
    Rel(operator, copilot, "Manages plans, active LLM, unit economics & sessions", "Cloudflare Zero Trust")
    Rel(copilot, storefront, "OAuth / HMAC webhooks / XML feed pull / Cart Adapter bridge", "HTTPS")
    Rel(copilot, aigw, "Bounded ReAct steps & batch embeddings", "HTTPS")
    Rel(copilot, langfuse, "Non-blocking step telemetry (ctx.waitUntil)", "HTTPS")
```

---

## 2. C4 Level 2 — Three-Plane Container Topology

```mermaid
flowchart TB
    subgraph Client["Client & Storefront Layer"]
        Widget["<commerce-copilot-widget>\nPreact 10 + Shadow DOM (~15 KB gzip)\nCartAdapter (Shopify / WooCommerce / Custom)"]
        PortalUI["Merchant Self-Service Portal (/dashboard)\nLive postMessage Preview + Knowledge RAG"]
        AdminUI["Operator FinOps Console\nUnit Economics Simulator + Session Audit"]
    end

    subgraph DataPlane["Data Plane — Core Edge Worker"]
        Router["REST & SSE Dispatcher\nRate Limiter + SSRF Guard + HMAC Webhooks"]
        ReAct["Bounded Native ReAct Engine\nStatic 6-Tool ACI + Parallel Read / Serial Write"]
        RAG["Hybrid RAG + SQL Vector Bypass\nRRF (k=60) + Compare Matrix + Cart Validation"]
        Connectors["Universal Connectors\nShopify OAuth | Google/Meta XML | REST Push | Platform Detect"]
    end

    subgraph ControlPlane["Control Plane — Admin Worker"]
        ZeroTrust["Cloudflare Zero Trust Gate\nJWKS Cache + RSASSA-PKCS1-v1_5 + aud/exp"]
        FinOps["FinOps & Model Governance\nActive Model Switch + Margin Simulator + Core Proxy"]
    end

    subgraph Storage["Edge Persistence & AI Gateway"]
        D1[("Cloudflare D1 (SQLite)\n10 Multi-Tenant Tables\n0 Raw Embeddings Stored")]
        Vec[("Cloudflare Vectorize\nSingle 768d Index\ndoc_type: product | knowledge")]
        R2[("Cloudflare R2\nSandboxed Vision Uploads")]
        Gateway["Cloudflare AI Gateway\nLLM Routing + Embeddings + Caching"]
    end

    Widget -->|"POST /api/v1/chat (SSE)"| Router
    PortalUI -->|"Cookie Auth (/api/v1/merchant/*)"| Router
    PortalUI -.->|"postMessage ($0 live preview)"| Widget
    AdminUI -->|"Cf-Access-Jwt-Assertion"| ZeroTrust --> FinOps

    Router --> ReAct
    ReAct --> RAG
    Router --> Connectors

    RAG --> D1
    RAG --> Vec
    Connectors --> D1
    Connectors --> Vec
    Router --> R2
    ReAct --> Gateway
    FinOps --> D1
    FinOps -->|"X-Admin-Key Proxy (XML/Knowledge/Claim)"| Router
```

---

## 3. C4 Level 3 — Core Worker Component Boundaries

Inside the Core Worker, domain policy is strictly separated from orchestration, LLM transport, and persistence:

| Layer | Module Responsibility | Key Invariant |
| :--- | :--- | :--- |
| **HTTP & Security** | `core/auth.mjs`, `core/merchant_auth.mjs`, `core/ssrf.mjs`, `core/r2.mjs` | Fail-closed auth, PBKDF2-SHA256 (`100k`), HTTPS-only SSRF & redirect validation, `sandbox` CSP for R2 images |
| **Agent Orchestrator** | `agent/react_loop.mjs`, `agent/registry.mjs`, `agent/loop_detector.mjs` | Provider- and domain-agnostic loop; static tool declarations preserve KV-cache prefix |
| **LLM Abstraction** | `llm/provider.mjs`, `llm/providers/gemini.mjs`, `llm/langfuse.mjs` | Isolates wire format (`streamChat`, `chat`, `embedText`, `embedBatch`) and async OTel spans |
| **Domain Tooling** | `domain/commerce/tools.mjs`, `domain/commerce/prompts.mjs` | Exposes 6 static tools (or vertical extensions such as `calculate_aquarium_specs`) |
| **RAG & Cart** | `rag/search.mjs`, `rag/knowledge_search.mjs`, `rag/compare.mjs`, `cart/cart_mutation.mjs` | Dual-doc Vectorize queries, SQL Vector Bypass (`embedCallCount == 0`), fail-loud variant checks |
| **Connectors** | `connectors/shopify.mjs`, `connectors/xml_feed.mjs`, `connectors/rest_push.mjs`, `connectors/platform_detect.mjs` | Unified ingestion pipeline into `(shop_domain, external_id)` + incremental hash-based re-indexing |

---

## 4. Multi-Tenant D1 Schema (10 Tables)

All tenant data is partitioned by `shop_domain` with composite covering indexes on `(shop_domain, in_stock, price)` and `(shop_domain, category, in_stock)`. Raw 768-dimensional float vectors are **never** stored in D1; D1 holds only 16-character `text_hash` / `embedded_text_hash` fingerprints.

```mermaid
erDiagram
    subscription_plans ||--o{ shops : "governs budget & session cap"
    shops ||--o{ products : "owns catalog"
    shops ||--o{ store_knowledge : "owns policy/FAQ docs"
    shops ||--o{ chat_sessions : "scopes visitor state"
    shops ||--o{ analytics_events : "tracks funnel"
    shops ||--o{ shop_members : "grants RBAC"
    merchant_users ||--o{ shop_members : "belongs to"
    shops ||--o{ shop_claim_tokens : "issues claim/ingest tokens"

    shops {
        text shop_domain PK
        text platform_type
        text plan_id
        real custom_monthly_budget_usd
        real spent_this_month_usd
        text primary_color
        text xml_feed_url
    }
    products {
        int id PK
        text shop_domain
        text external_id
        real price
        int in_stock
        text attributes
        text variants
        text embedded_text_hash
    }
    store_knowledge {
        int id PK
        text shop_domain
        text doc_key
        text doc_type
        text text_hash
        text embedded_text_hash
    }
    chat_sessions {
        int id PK
        text session_id
        text shop_domain
        text messages
        text last_bundle
        real session_cost_usd
        int is_finalized
    }
    merchant_users {
        int id PK
        text email UK
        text password_hash
    }
    shop_members {
        int id PK
        text shop_domain
        int user_id
        text role
    }
    shop_claim_tokens {
        text token_hash PK
        text shop_domain
        text token_type
        text expires_at
        text used_at
    }
```
