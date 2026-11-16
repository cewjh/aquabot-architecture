# ADR-003: Preact + Shadow DOM (~20 KB gzip) Over Iframe Embedding

* **Status:** Accepted
* **Context:** AquaBot's chat widget must be embedded into arbitrary merchant storefronts (Shopify themes, WooCommerce, Next.js, Webflow) without breaking host styles or being broken by aggressive theme CSS resets.
* **Decision:** Build the frontend as a standalone **Preact 10** Custom Element (`<aquarium-ai-widget>`) with **Shadow DOM** encapsulation, compiled into a single `~20 KB` gzip IIFE bundle served directly from the Edge Worker.
* **Alternatives Considered:**
  1. *`<iframe>` Embed:* Strong isolation, but causes awkward mobile viewport sizing, modal clipping, slower cross-frame state/cart communication, and extra round-trips.
  2. *React SPA without Shadow DOM:* Larger bundle footprint (`>45 KB` gzip) and high risk of CSS collisions with host themes.
* **Consequences & Trade-offs:**
  * **Pros:** Complete CSS isolation without `<iframe>` UX friction, tiny `~20 KB` gzip payload, direct DOM/Shopify `/cart/add.js` integration, and `requestAnimationFrame`-throttled 60fps SSE rendering.
  * **Cons:** All widget styles must be scoped and injected inside the Shadow Root; third-party CSS frameworks expecting global `document` styles require careful build configuration.
