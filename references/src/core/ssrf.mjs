/**
 * SSRF Boundary Guard for External Catalog Feeds, Storefront Detection, and Policy URLs.
 * Pure Web Standards implementation (no Node-only or vendor-specific dependencies).
 */

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.goog",
  "169.254.169.254",
]);

function isPrivateOrReservedIpv4(hostname) {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;

  const octets = match.slice(1).map((n) => parseInt(n, 10));
  if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return true;

  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateOrReservedIpv6(hostname) {
  const clean = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!clean.includes(":")) return false;
  if (clean === "::" || clean === "::1") return true;
  if (clean.startsWith("fe80:") || clean.startsWith("fc") || clean.startsWith("fd")) return true;
  if (clean.startsWith("::ffff:")) {
    const mapped = clean.slice(7);
    if (isPrivateOrReservedIpv4(mapped)) return true;
    // WHATWG URL parser normalizes ::ffff:127.0.0.1 -> ::ffff:7f00:1
    const hexPair = mapped.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexPair) {
      const hi = parseInt(hexPair[1], 16);
      const lo = parseInt(hexPair[2], 16);
      const dotted = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      if (isPrivateOrReservedIpv4(dotted)) return true;
    }
  }
  return false;
}

/**
 * Validates external URLs against SSRF vectors.
 * Enforces HTTPS-only and blocks loopback, RFC1918, CGNAT, cloud metadata, and obfuscated IPs.
 */
export function validateExternalFeedUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new Error("URL is empty or invalid.");
  }

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("Malformed URL format.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Only HTTPS URLs are permitted for external ingestion.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Embedded URL credentials are not permitted.");
  }

  const host = parsed.hostname.toLowerCase();
  if (!host || BLOCKED_HOSTNAMES.has(host)) {
    throw new Error(`Blocked or internal hostname: ${host}`);
  }
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) {
    throw new Error(`Internal network domain blocked: ${host}`);
  }
  if (isPrivateOrReservedIpv4(host) || isPrivateOrReservedIpv6(host)) {
    throw new Error(`Private or reserved IP address blocked: ${host}`);
  }
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) {
    throw new Error("Numeric or hexadecimal IP representation blocked.");
  }

  return parsed.toString();
}

/**
 * Fetches text from a validated HTTPS external URL with manual redirect validation,
 * timeout enforcement, and strict response byte capping.
 */
export async function safeFetchRemoteText(
  rawUrl,
  { timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES, maxRedirects = 3, fetchImpl = fetch } = {}
) {
  let currentUrl = validateExternalFeedUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let hops = 0;
    while (true) {
      const resp = await fetchImpl(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "CommerceCopilot-Ingestion/1.0",
          Accept: "application/xml, text/xml, application/rss+xml, application/atom+xml, text/html, text/plain;q=0.9",
        },
      });

      if (resp.status >= 300 && resp.status < 400) {
        const loc = resp.headers?.get?.("location");
        if (!loc || hops >= maxRedirects) {
          throw new Error(`Too many or invalid redirects (HTTP ${resp.status}).`);
        }
        const resolved = new URL(loc, currentUrl).toString();
        currentUrl = validateExternalFeedUrl(resolved);
        hops += 1;
        continue;
      }

      if (!resp.ok) {
        throw new Error(`Upstream server error: HTTP ${resp.status}`);
      }

      const contentLen = parseInt(resp.headers?.get?.("content-length") || "0", 10);
      if (Number.isFinite(contentLen) && contentLen > maxBytes) {
        throw new Error(`Content-Length limit exceeded (${contentLen} > ${maxBytes} bytes).`);
      }

      const buf = await resp.arrayBuffer();
      if (buf.byteLength > maxBytes) {
        throw new Error(`Response body exceeds maximum allowed size (${maxBytes} bytes).`);
      }

      const headersObj = {};
      if (resp.headers && typeof resp.headers.forEach === "function") {
        resp.headers.forEach((v, k) => {
          headersObj[String(k).toLowerCase()] = String(v);
        });
      }

      return {
        url: currentUrl,
        contentType: resp.headers?.get?.("content-type") || "",
        headers: headersObj,
        text: new TextDecoder("utf-8").decode(buf),
      };
    }
  } finally {
    clearTimeout(timer);
  }
}
