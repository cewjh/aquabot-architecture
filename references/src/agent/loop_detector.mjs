/**
 * Deterministic key-sorted JSON serialization for tool-call signature hashing.
 */
export function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

/**
 * Tracks repeated `(toolName, normalizedArgs)` invocations per turn to trip the loop circuit breaker.
 */
export function createLoopDetector(maxRepeats = 2) {
  const signatureCounts = new Map();

  return {
    recordAndCheck(toolName, args) {
      const sig = `${toolName}:${stableStringify(args || {})}`;
      const seenCount = (signatureCounts.get(sig) || 0) + 1;
      signatureCounts.set(sig, seenCount);
      return {
        signature: sig,
        seenCount,
        tripped: seenCount > maxRepeats,
      };
    },
  };
}
