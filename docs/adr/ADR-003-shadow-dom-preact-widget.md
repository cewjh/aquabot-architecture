# ADR-003: Preact + Shadow DOM Embeddable Widget Over Iframe Isolation

* **Status:** Accepted
* **Context:** The storefront assistant widget must embed cleanly across diverse merchant themes (Shopify, WooCommerce, ikas, Ticimax, T-Soft, custom headless SPAs) via a single `<script>` tag without host CSS collisions or mobile viewport clipping.
* **Decision:** Build the storefront client as a standalone **Preact 10** Custom Element (`<commerce-copilot-widget>`) encapsulated inside a **Shadow DOM** boundary, compiled into a `~15–22 KB` gzip IIFE bundle served directly from the Edge Worker.
* **Alternatives Considered:**
  1. *`<iframe>` Embed:* Strong isolation, but causes awkward mobile drawer resizing, modal clipping, slower cross-frame cart adapter communication, and extra HTML round-trips.
  2. *Unisolated React SPA:* Larger bundle footprint (`>45 KB` gzip) and high risk of host stylesheet overrides.
* **Consequences & Trade-offs:**
  * **Pros:** Total CSS encapsulation with zero `<iframe>` UX friction, tiny gzipped payload, direct DOM/storefront `CartAdapter` integration (custom events, Shopify `/cart/add.js`, WooCommerce `?wc-ajax=add_to_cart`), same-origin `postMessage` live preview inside `/dashboard`, and `requestAnimationFrame`-throttled 60fps SSE rendering.
  * **Cons:** All CSS variables and theme derivation (`color-mix()`) must remain scoped inside the Shadow Root; third-party CSS frameworks assuming global `document` stylesheets cannot be used as-is.
