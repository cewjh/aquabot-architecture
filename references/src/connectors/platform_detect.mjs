/**
 * SSRF-Guarded Storefront Platform Fingerprinting & Feed/Sitemap Discovery Engine.
 */
import { validateExternalFeedUrl, safeFetchRemoteText } from "../core/ssrf.mjs";

const PLATFORM_RULES = [
  {
    id: "shopify",
    displayName: "Shopify",
    recommendedConnector: "shopify",
    cartBridgeMode: "shopify_ajax",
    checks: [
      { type: "header", key: "x-shopid", weight: 0.95, label: "Header: X-ShopId" },
      { type: "header", key: "x-shopify-stage", weight: 0.9, label: "Header: X-Shopify-Stage" },
      { type: "html", pattern: /cdn\.shopify\.com/i, weight: 0.85, label: "CDN: cdn.shopify.com" },
      { type: "html", pattern: /<meta[^>]+name=["']generator["'][^>]+content=["'][^"']*shopify/i, weight: 0.9, label: "Meta generator: Shopify" },
      { type: "html", pattern: /Shopify\.shop\s*=|\/s\/files\/1\//i, weight: 0.8, label: "Shopify storefront runtime" },
    ],
  },
  {
    id: "woocommerce",
    displayName: "WooCommerce (WordPress)",
    recommendedConnector: "xml_feed",
    cartBridgeMode: "woocommerce_ajax",
    checks: [
      { type: "header", key: "link", pattern: /wp-json/i, weight: 0.55, label: "Header Link: wp-json" },
      { type: "html", pattern: /\/wp-content\/plugins\/woocommerce\//i, weight: 0.95, label: "Asset: /wp-content/plugins/woocommerce/" },
      { type: "html", pattern: /woocommerce_params|wc_cart_fragments_params/i, weight: 0.9, label: "Global JS: woocommerce_params" },
      { type: "html", pattern: /<meta[^>]+name=["']generator["'][^>]+content=["'][^"']*woocommerce/i, weight: 0.9, label: "Meta generator: WooCommerce" },
      { type: "html", pattern: /class=["'][^"']*\bwoocommerce\b/i, weight: 0.75, label: "DOM class: woocommerce" },
    ],
  },
  {
    id: "ikas",
    displayName: "ikas",
    recommendedConnector: "xml_feed",
    cartBridgeMode: "custom_event",
    checks: [
      { type: "html", pattern: /cdn\.ikas\.com|ikas\.io/i, weight: 0.9, label: "CDN: ikas" },
      { type: "html", pattern: /window\.ikas\b|__NEXT_DATA__[^>]*ikas/i, weight: 0.85, label: "Hydration: ikas" },
    ],
  },
  {
    id: "ticimax",
    displayName: "Ticimax",
    recommendedConnector: "xml_feed",
    cartBridgeMode: "custom_event",
    checks: [
      { type: "html", pattern: /ticimax/i, weight: 0.85, label: "Signature: ticimax" },
      { type: "html", pattern: /\/Scripts\/Site\/|\/Uploads\/UrunResimleri\//i, weight: 0.75, label: "Asset path: Ticimax" },
    ],
  },
  {
    id: "tsoft",
    displayName: "T-Soft",
    recommendedConnector: "xml_feed",
    cartBridgeMode: "custom_event",
    checks: [
      { type: "html", pattern: /\/T-Soft\/|tsoftapps\.com/i, weight: 0.9, label: "Asset path: T-Soft" },
      { type: "html", pattern: /<meta[^>]+content=["'][^"']*t-soft/i, weight: 0.85, label: "Meta: T-Soft" },
    ],
  },
];

export function normalizeStorefrontInputUrl(rawInput) {
  let clean = String(rawInput || "").trim();
  if (!clean) throw new Error("Storefront URL cannot be empty.");
  if (!/^https?:\/\//i.test(clean)) {
    clean = `https://${clean}`;
  }
  return validateExternalFeedUrl(clean);
}

export function extractFeedLinksFromHtml(html, baseUrl) {
  const feeds = new Set();
  const linkRegex = /<link\b[^>]*>/gi;
  let m;
  while ((m = linkRegex.exec(html || "")) !== null) {
    const tag = m[0];
    const relMatch = tag.match(/rel=["']([^"']+)["']/i);
    const typeMatch = tag.match(/type=["']([^"']+)["']/i);
    const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    const rel = (relMatch?.[1] || "").toLowerCase();
    const typ = (typeMatch?.[1] || "").toLowerCase();
    const href = hrefMatch[1];
    if (
      rel.includes("alternate") &&
      (typ.includes("xml") || typ.includes("rss") || typ.includes("atom") || /feed|sitemap/i.test(href))
    ) {
      try {
        feeds.add(new URL(href, baseUrl).toString());
      } catch {}
    }
  }
  return [...feeds].slice(0, 8);
}

export function extractSitemapsFromRobots(robotsText, baseUrl) {
  const sitemaps = new Set();
  for (const line of String(robotsText || "").split(/\r?\n/)) {
    const m = line.match(/^\s*sitemap\s*:\s*(\S+)/i);
    if (m && m[1]) {
      try {
        sitemaps.add(new URL(m[1].trim(), baseUrl).toString());
      } catch {}
    }
  }
  return [...sitemaps].slice(0, 8);
}

export function analyzeStorefrontFingerprint({ html = "", headers = {} }) {
  const scores = [];
  for (const rule of PLATFORM_RULES) {
    let maxWeight = 0;
    const evidence = [];
    for (const chk of rule.checks) {
      if (chk.type === "header") {
        const val = headers?.[chk.key];
        if (val !== undefined && (!chk.pattern || chk.pattern.test(String(val)))) {
          maxWeight = Math.max(maxWeight, chk.weight);
          evidence.push(chk.label);
        }
      } else if (chk.type === "html" && chk.pattern.test(html)) {
        maxWeight = Math.max(maxWeight, chk.weight);
        evidence.push(chk.label);
      }
    }
    if (evidence.length > 0) {
      const bonus = Math.min(0.15, (evidence.length - 1) * 0.05);
      scores.push({
        rule,
        confidence: Math.min(0.99, Math.round((maxWeight + bonus) * 100) / 100),
        evidence,
      });
    }
  }

  scores.sort((a, b) => b.confidence - a.confidence);
  const top = scores[0];
  if (!top) {
    return {
      detected_platform: "custom",
      display_name: "Custom / Headless Storefront",
      confidence: 0.5,
      evidence: ["No standard CMS fingerprint detected; XML Feed or REST Push supported."],
      recommended_connector: "xml_feed",
      cart_bridge_mode: "custom_event",
    };
  }

  return {
    detected_platform: top.rule.id,
    display_name: top.rule.displayName,
    confidence: top.confidence,
    evidence: top.evidence,
    recommended_connector: top.rule.recommendedConnector,
    cart_bridge_mode: top.rule.cartBridgeMode,
  };
}

export async function detectStorefrontPlatform(rawInputUrl, { fetchImpl = fetch } = {}) {
  const normalizedUrl = normalizeStorefrontInputUrl(rawInputUrl);
  const parsed = new URL(normalizedUrl);
  const origin = parsed.origin;
  const suggestedDomain = parsed.hostname.replace(/^www\./i, "").toLowerCase();

  const pageResp = await safeFetchRemoteText(normalizedUrl, {
    timeoutMs: 8000,
    maxBytes: 512 * 1024,
    fetchImpl,
  });

  const analysis = analyzeStorefrontFingerprint({
    html: pageResp.text,
    headers: pageResp.headers || {},
  });
  const discoveredFeeds = extractFeedLinksFromHtml(pageResp.text, pageResp.url);

  let discoveredSitemaps = [];
  try {
    const robotsResp = await safeFetchRemoteText(`${origin}/robots.txt`, {
      timeoutMs: 3500,
      maxBytes: 128 * 1024,
      fetchImpl,
    });
    discoveredSitemaps = extractSitemapsFromRobots(robotsResp.text, origin);
  } catch {}

  return {
    normalized_url: pageResp.url || normalizedUrl,
    suggested_domain: suggestedDomain,
    ...analysis,
    discovered_feeds: discoveredFeeds,
    discovered_sitemaps: discoveredSitemaps,
  };
}
