/**
 * Pure Web-Standards SSE & Sliding-Tail `<quick_replies>` Streaming Helpers.
 */

const QUICK_REPLIES_OPEN = "<quick_replies>";
const QUICK_REPLIES_CLOSE = "</quick_replies>";

export function sseFormatEvent(eventName, payload) {
  return `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function parseSseBlockStream(readableBody, onEvent) {
  if (!readableBody) return;
  const reader = readableBody.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let currentEvent = "message";
  let dataLines = [];

  const dispatchBlock = async () => {
    if (dataLines.length === 0) {
      currentEvent = "message";
      return;
    }
    const rawData = dataLines.join("\n");
    const evtName = currentEvent || "message";
    currentEvent = "message";
    dataLines = [];
    await onEvent({ event: evtName, data: rawData });
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      let nlIndex;
      while ((nlIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nlIndex);
        buffer = buffer.slice(nlIndex + 1);
        if (line === "") {
          await dispatchBlock();
        } else if (line.startsWith(":")) {
          // Heartbeat comment
        } else if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          const val = line.slice(5);
          dataLines.push(val.startsWith(" ") ? val.slice(1) : val);
        }
      }
    }

    buffer += decoder.decode().replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (buffer.length > 0) {
      for (const line of buffer.split("\n")) {
        if (line === "") {
          await dispatchBlock();
        } else if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          const val = line.slice(5);
          dataLines.push(val.startsWith(" ") ? val.slice(1) : val);
        }
      }
    }
    if (dataLines.length > 0) {
      await dispatchBlock();
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}

export async function consumeModelSseStream(readableBody, onTextDelta) {
  let fullText = "";
  const functionCalls = [];
  const rawParts = [];
  let usage = null;

  await parseSseBlockStream(readableBody, async ({ data }) => {
    const trimmed = (data || "").trim();
    if (!trimmed || trimmed === "[DONE]") return;

    let chunk;
    try {
      chunk = JSON.parse(trimmed);
    } catch {
      return;
    }

    if (chunk.usageMetadata) {
      usage = chunk.usageMetadata;
    }

    const parts = chunk?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return;

    for (const part of parts) {
      if (!part || typeof part !== "object") continue;

      if (part.functionCall || part.thoughtSignature || part.thought) {
        if (part.functionCall) {
          functionCalls.push(part.functionCall);
        }
        rawParts.push(part);
      } else if (typeof part.text === "string" && part.text.length > 0) {
        fullText += part.text;
        const last = rawParts[rawParts.length - 1];
        if (last && typeof last.text === "string" && !last.functionCall && !last.thoughtSignature && !last.thought) {
          last.text += part.text;
        } else {
          rawParts.push({ text: part.text });
        }
        if (typeof onTextDelta === "function") {
          await onTextDelta(part.text);
        }
      }
    }
  });

  return {
    text: fullText.trim() ? fullText.trim() : null,
    functionCalls,
    functionCall: functionCalls[0] || null,
    rawParts,
    usage,
  };
}

export function parseQuickRepliesArray(rawInner) {
  if (!rawInner || typeof rawInner !== "string") return [];
  const cleaned = rawInner
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!cleaned) return [];

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    const out = [];
    for (const item of parsed) {
      if (typeof item !== "string") continue;
      const trimmed = item.replace(/\s+/g, " ").trim().slice(0, 80);
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
      if (out.length >= 3) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function extractQuickRepliesFromText(text) {
  if (!text || typeof text !== "string") {
    return { cleanText: "", quickReplies: [] };
  }
  const openIdx = text.indexOf(QUICK_REPLIES_OPEN);
  if (openIdx === -1) {
    return { cleanText: text.trim(), quickReplies: [] };
  }
  const before = text.slice(0, openIdx).trimEnd();
  const afterOpen = text.slice(openIdx + QUICK_REPLIES_OPEN.length);
  const closeIdx = afterOpen.indexOf(QUICK_REPLIES_CLOSE);
  if (closeIdx === -1) {
    return { cleanText: before, quickReplies: [] };
  }
  return {
    cleanText: before,
    quickReplies: parseQuickRepliesArray(afterOpen.slice(0, closeIdx)),
  };
}

function computeSafeEmitCutoff(pending) {
  const lastLt = pending.lastIndexOf("<");
  if (lastLt !== -1) {
    const tail = pending.slice(lastLt);
    if (QUICK_REPLIES_OPEN.startsWith(tail)) {
      let cutoff = lastLt;
      while (cutoff > 0 && (pending[cutoff - 1] === "\n" || pending[cutoff - 1] === "\r" || pending[cutoff - 1] === " ")) {
        cutoff--;
      }
      return cutoff;
    }
  }
  let cutoff = pending.length;
  let heldWs = 0;
  while (cutoff > 0 && heldWs < 4 && (pending[cutoff - 1] === "\n" || pending[cutoff - 1] === "\r" || pending[cutoff - 1] === " ")) {
    cutoff--;
    heldWs++;
  }
  return cutoff;
}

/**
 * Sliding-tail stream filter that withholds potential partial `<quick_replies>` tags
 * across chunk boundaries while emitting safe prose immediately (including inline `<` comparisons).
 */
export function createQuickRepliesStreamFilter(onSafeDelta) {
  let pending = "";
  let inTag = false;
  let tagClosed = false;
  let tagBuffer = "";

  const emit = async (chunk) => {
    if (chunk && typeof onSafeDelta === "function") {
      await onSafeDelta(chunk);
    }
  };

  return {
    async push(deltaText) {
      if (!deltaText || typeof deltaText !== "string") return;
      if (tagClosed) return;

      if (inTag) {
        tagBuffer += deltaText;
        if (tagBuffer.includes(QUICK_REPLIES_CLOSE)) {
          tagClosed = true;
        }
        return;
      }

      pending += deltaText;
      const openIdx = pending.indexOf(QUICK_REPLIES_OPEN);
      if (openIdx !== -1) {
        const before = pending.slice(0, openIdx).replace(/\s+$/, "");
        await emit(before);
        inTag = true;
        tagBuffer = pending.slice(openIdx + QUICK_REPLIES_OPEN.length);
        pending = "";
        if (tagBuffer.includes(QUICK_REPLIES_CLOSE)) {
          tagClosed = true;
        }
        return;
      }

      const cutoff = computeSafeEmitCutoff(pending);
      if (cutoff > 0) {
        const safePrefix = pending.slice(0, cutoff);
        pending = pending.slice(cutoff);
        await emit(safePrefix);
      }
    },

    async flush() {
      if (!inTag) {
        if (pending.length > 0) {
          const remaining = pending;
          pending = "";
          await emit(remaining);
        }
        return { quickReplies: [] };
      }

      const closeIdx = tagBuffer.indexOf(QUICK_REPLIES_CLOSE);
      if (closeIdx === -1) {
        return { quickReplies: [] };
      }
      return { quickReplies: parseQuickRepliesArray(tagBuffer.slice(0, closeIdx)) };
    },
  };
}
