import test from "node:test";
import assert from "node:assert/strict";

import {
  consumeModelSseStream,
  createQuickRepliesStreamFilter,
  extractQuickRepliesFromText,
} from "../src/streaming/sse_filter.mjs";
import {
  analyzeStorefrontFingerprint,
  detectStorefrontPlatform,
  extractFeedLinksFromHtml,
  extractSitemapsFromRobots,
} from "../src/connectors/platform_detect.mjs";

test("SSE Stream Parser: handles multi-byte UTF-8 chunks split mid-codepoint and preserves thoughtSignature", async () => {
  const payload =
    'data: {"candidates":[{"content":{"parts":[{"text":"Price: €45 — Türkçe karakterler: şğüöçı"}]}}]}\n\n' +
    'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"search_catalog","args":{"query":"shoe"}},"thoughtSignature":"opaque_sig_123"}]}}]}\n\n' +
    "data: [DONE]\n\n";

  const bytes = new TextEncoder().encode(payload);
  // Split at arbitrary byte offsets (including inside multi-byte UTF-8 characters)
  const body = new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 7) {
        controller.enqueue(bytes.slice(i, i + 7));
      }
      controller.close();
    },
  });

  const deltas = [];
  const parsed = await consumeModelSseStream(body, async (d) => deltas.push(d));
  assert.equal(deltas.join(""), "Price: €45 — Türkçe karakterler: şğüöçı");
  assert.equal(parsed.functionCalls[0].name, "search_catalog");
  assert.equal(parsed.rawParts[1].thoughtSignature, "opaque_sig_123");
});

test("Sliding-Tail <quick_replies> Filter: suppresses partial tag across chunks while preserving inline '<' math", async () => {
  const emitted = [];
  const filter = createQuickRepliesStreamFilter(async (delta) => emitted.push(delta));

  const chunks = [
    "Filter flow < 500 L/h is ideal. ",
    "Ready to order?",
    "\n<quick_",
    'replies>["Show canisters", "Compare heaters"]</quick_replies>',
  ];
  for (const ch of chunks) {
    await filter.push(ch);
  }
  const { quickReplies } = await filter.flush();

  assert.equal(emitted.join(""), "Filter flow < 500 L/h is ideal. Ready to order?");
  assert.deepEqual(quickReplies, ["Show canisters", "Compare heaters"]);

  const extracted = extractQuickRepliesFromText('Hello!\n<quick_replies>["A", "B", "C", "D"]</quick_replies>');
  assert.equal(extracted.cleanText, "Hello!");
  assert.deepEqual(extracted.quickReplies, ["A", "B", "C"]);
});

test("Platform Fingerprinting & Discovery: detects WooCommerce/Shopify/ikas/Ticimax/T-Soft and extracts feeds/sitemaps", async () => {
  const woo = analyzeStorefrontFingerprint({
    headers: { link: '<https://demo-woo.example.com/wp-json/>; rel="https://api.w.org/"' },
    html: '<html><head><meta name="generator" content="WooCommerce 9.0"></head><body class="woocommerce"><script src="/wp-content/plugins/woocommerce/assets/js/frontend.js"></script></body></html>',
  });
  assert.equal(woo.detected_platform, "woocommerce");
  assert.equal(woo.cart_bridge_mode, "woocommerce_ajax");
  assert.ok(woo.confidence >= 0.9);

  const shopify = analyzeStorefrontFingerprint({
    headers: { "x-shopid": "123456" },
    html: '<script src="https://cdn.shopify.com/s/files/1/shop.js"></script>',
  });
  assert.equal(shopify.detected_platform, "shopify");
  assert.equal(shopify.recommended_connector, "shopify");

  const ikas = analyzeStorefrontFingerprint({
    html: '<script src="https://cdn.ikas.com/app.js"></script><script>window.ikas = {};</script>',
  });
  assert.equal(ikas.detected_platform, "ikas");

  const mockFetch = async (url) => {
    if (url.endsWith("/robots.txt")) {
      return new Response("User-agent: *\nSitemap: https://brand.example.com/sitemap_products.xml\n", { status: 200 });
    }
    return new Response(
      '<html><head><link rel="alternate" type="application/rss+xml" href="/feeds/google-merchant.xml"><meta name="generator" content="Ticimax"></head></html>',
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  };

  const discovery = await detectStorefrontPlatform("brand.example.com", { fetchImpl: mockFetch });
  assert.equal(discovery.detected_platform, "ticimax");
  assert.deepEqual(discovery.discovered_feeds, ["https://brand.example.com/feeds/google-merchant.xml"]);
  assert.deepEqual(discovery.discovered_sitemaps, ["https://brand.example.com/sitemap_products.xml"]);
  assert.equal(
    extractFeedLinksFromHtml('<link rel="alternate" type="application/atom+xml" href="/atom.xml">', "https://x.com")[0],
    "https://x.com/atom.xml"
  );
  assert.equal(
    extractSitemapsFromRobots("Sitemap: /sitemap.xml", "https://x.com")[0],
    "https://x.com/sitemap.xml"
  );
});
