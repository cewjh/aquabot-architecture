/**
 * Provider- and Domain-Agnostic Bounded Native ReAct Orchestrator + Read/Write Tool Registry.
 */
import { createLoopDetector } from "./loop_detector.mjs";
import { createQuickRepliesStreamFilter, extractQuickRepliesFromText } from "../streaming/sse_filter.mjs";

const MAX_TOOL_RESPONSE_CHARS = 16000;

export function createToolRegistry(toolList = []) {
  const byName = new Map();
  const declarations = [];

  for (const tool of toolList) {
    if (!tool?.declaration?.name) continue;
    byName.set(tool.declaration.name, {
      name: tool.declaration.name,
      mode: tool.mode === "write" ? "write" : "read",
      declaration: tool.declaration,
      statusStart: tool.statusStart || null,
      statusDone: tool.statusDone || null,
      execute: tool.execute,
    });
    declarations.push(tool.declaration);
  }

  return {
    get(name) {
      return byName.get(name) || null;
    },
    has(name) {
      return byName.has(name);
    },
    getToolDeclarations() {
      return [...declarations];
    },
  };
}

function capToolResponsePayload(payload) {
  const serialized = JSON.stringify(payload);
  if (serialized.length <= MAX_TOOL_RESPONSE_CHARS) {
    return payload;
  }
  if (Array.isArray(payload?.products) && payload.products.length > 3) {
    const trimmed = { ...payload, products: payload.products.slice(0, 3), truncated: true };
    if (JSON.stringify(trimmed).length <= MAX_TOOL_RESPONSE_CHARS) {
      return trimmed;
    }
  }
  return {
    status: payload?.status || "truncated",
    summary: serialized.slice(0, MAX_TOOL_RESPONSE_CHARS - 200) + "... [truncated]",
  };
}

/**
 * Runs a Bounded Native ReAct loop with:
 * - Static tool declaration prefix across all steps (KV-cache prefix invariance)
 * - Concurrent `mode: "read"` dispatch via `Promise.all` and serialized `mode: "write"` execution
 * - `(toolName, normalizedArgs)` loop circuit breaker
 * - Dual step & FinOps budget ceilings with tool-free graceful wrap-up
 */
export async function runBoundedAgentLoop({
  llmProvider,
  contents,
  systemPrompt,
  registry,
  state = {},
  wantsStream = false,
  sseEmit = async () => {},
  maxSteps = 8,
  budgetRemainingUsd = Infinity,
  calculateCostUsd = () => 0,
}) {
  if (!llmProvider) throw new Error("llmProvider is required.");

  const aiResponses = [];
  const toolsCalled = [];
  const loopDetector = createLoopDetector(2);
  const workingContents = [...contents];
  const toolDeclarations = registry.getToolDeclarations();

  let step = 0;
  let spentInTurn = 0;
  let firstCallEmittedText = false;

  const invokeModelTurn = async ({ useTools, stepTag, resetBeforeStream }) => {
    let emittedInThisCall = false;
    let needsReset = Boolean(resetBeforeStream);
    let streamFilter = null;

    if (wantsStream) {
      streamFilter = createQuickRepliesStreamFilter(async (safeDelta) => {
        if (!safeDelta) return;
        emittedInThisCall = true;
        firstCallEmittedText = true;
        const resetFlag = needsReset;
        needsReset = false;
        await sseEmit("delta", { text: safeDelta, reset: resetFlag });
      });
    }

    const reqOpts = {
      contents: workingContents,
      systemPrompt,
      tools: useTools ? toolDeclarations : null,
      metadata: { step: stepTag },
    };

    const res = wantsStream
      ? await llmProvider.streamChat(reqOpts, async (deltaText) => {
          await streamFilter.push(deltaText);
        })
      : await llmProvider.chat(reqOpts);

    let quickReplies = [];
    if (wantsStream && streamFilter) {
      const flushed = await streamFilter.flush();
      quickReplies = flushed.quickReplies || [];
    } else if (res.text) {
      quickReplies = extractQuickRepliesFromText(res.text).quickReplies || [];
    }

    const cleanText = res.text ? extractQuickRepliesFromText(res.text).cleanText : "";
    aiResponses.push(res);
    spentInTurn += Number(calculateCostUsd(res) || 0);

    return { res, cleanText, quickReplies, emittedInThisCall };
  };

  while (step < maxSteps) {
    if (step > 0 && Number.isFinite(budgetRemainingUsd) && spentInTurn >= budgetRemainingUsd) {
      break;
    }

    const { res, cleanText, quickReplies, emittedInThisCall } = await invokeModelTurn({
      useTools: true,
      stepTag: step === 0 ? "react_initial" : `react_step_${step}`,
      resetBeforeStream: step > 0 && firstCallEmittedText,
    });

    if (res.error) {
      return {
        ok: false,
        error: res.error,
        assistantMessage: "",
        quickReplies: [],
        aiResponses,
        toolsCalled,
        contents: workingContents,
        spentInTurn,
      };
    }

    const calls = Array.isArray(res.functionCalls) && res.functionCalls.length > 0
      ? res.functionCalls
      : (res.functionCall ? [res.functionCall] : []);

    if (calls.length === 0) {
      return {
        ok: true,
        assistantMessage: cleanText,
        quickReplies,
        aiResponses,
        toolsCalled,
        contents: workingContents,
        spentInTurn,
      };
    }

    if (emittedInThisCall) {
      firstCallEmittedText = true;
    }

    step += 1;
    const readIndices = [];
    const writeIndices = [];
    const responsesByIdx = new Array(calls.length);

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const tool = registry.get(call.name);
      const check = loopDetector.recordAndCheck(call.name, call.args || {});

      if (!tool) {
        responsesByIdx[i] = {
          status: "unknown_tool",
          note: `Tool '${call.name}' is not registered. Use declared tools only.`,
        };
        continue;
      }

      if (check.tripped) {
        responsesByIdx[i] = {
          status: "loop_detected",
          note: "Identical tool invocation repeated without new progress. Synthesize from existing grounded context or try distinct arguments.",
        };
        continue;
      }

      toolsCalled.push(call.name);
      if (tool.mode === "read") {
        readIndices.push(i);
      } else {
        writeIndices.push(i);
      }
    }

    if (readIndices.length > 0) {
      await Promise.all(
        readIndices.map(async (idx) => {
          const call = calls[idx];
          const tool = registry.get(call.name);
          try {
            const result = await tool.execute(call.args || {}, state);
            responsesByIdx[idx] = capToolResponsePayload(result);
          } catch (err) {
            responsesByIdx[idx] = { status: "error", detail: err?.message || "Tool execution failed." };
          }
        })
      );
    }

    for (const idx of writeIndices) {
      const call = calls[idx];
      const tool = registry.get(call.name);
      try {
        const result = await tool.execute(call.args || {}, state);
        responsesByIdx[idx] = capToolResponsePayload(result);
      } catch (err) {
        responsesByIdx[idx] = { status: "error", detail: err?.message || "Tool execution failed." };
      }
    }

    const modelParts = Array.isArray(res.rawParts) && res.rawParts.length > 0
      ? res.rawParts
      : calls.map((c) => ({ functionCall: c }));

    workingContents.push({ role: "model", parts: modelParts });
    workingContents.push({
      role: "user",
      parts: calls.map((c, idx) => ({
        functionResponse: {
          name: c.name,
          response: responsesByIdx[idx] || { status: "ok" },
        },
      })),
    });
  }

  const wrapUp = await invokeModelTurn({
    useTools: false,
    stepTag: "graceful_wrapup",
    resetBeforeStream: firstCallEmittedText,
  });

  if (wrapUp.res.error) {
    return {
      ok: false,
      error: wrapUp.res.error,
      assistantMessage: "",
      quickReplies: [],
      aiResponses,
      toolsCalled,
      contents: workingContents,
      spentInTurn,
    };
  }

  return {
    ok: true,
    assistantMessage: wrapUp.cleanText,
    quickReplies: wrapUp.quickReplies,
    aiResponses,
    toolsCalled,
    contents: workingContents,
    spentInTurn,
  };
}
