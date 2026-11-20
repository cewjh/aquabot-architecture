import test from "node:test";
import assert from "node:assert/strict";

import { createLoopDetector, stableStringify } from "../src/agent/loop_detector.mjs";
import { createToolRegistry, runBoundedAgentLoop } from "../src/agent/registry_and_loop.mjs";
import { createCartBundle, modifyCart } from "../src/cart/cart_mutation.mjs";

const DEMO_PRODUCTS = [
  {
    id: 1,
    external_id: "tee-100",
    title: "Performance Running Tee",
    brand: "AeroRun",
    category: "apparel",
    price: 45,
    in_stock: 1,
    variants: [
      { id: "v-tee-s", title: "Small", price: 45, available: true },
      { id: "v-tee-m", title: "Medium", price: 45, available: true },
      { id: "v-tee-xl", title: "XL", price: 49, available: false },
    ],
  },
  {
    id: 2,
    external_id: "shoe-200",
    title: "Carbon Tempo Shoes",
    brand: "AeroRun",
    category: "footwear",
    price: 160,
    in_stock: 1,
    variants: [
      { id: "v-shoe-42", title: "EU 42", price: 160, available: true },
      { id: "v-shoe-43", title: "EU 43", price: 160, available: true },
    ],
  },
];

test("Loop Detector: canonicalizes key ordering and trips strictly after maxRepeats", () => {
  assert.equal(stableStringify({ b: 2, a: 1 }), stableStringify({ a: 1, b: 2 }));

  const detector = createLoopDetector(2);
  assert.equal(detector.recordAndCheck("search_catalog", { query: "tee", min_price: 20 }).tripped, false);
  assert.equal(detector.recordAndCheck("search_catalog", { min_price: 20, query: "tee" }).tripped, false);
  const third = detector.recordAndCheck("search_catalog", { query: "tee", min_price: 20 });
  assert.equal(third.seenCount, 3);
  assert.equal(third.tripped, true);
});

test("Cart Mutation Engine: fail-loud invalid_variant_id, out-of-stock rejection, and atomic replace", () => {
  const invalidRes = createCartBundle(
    {
      bundle_type: "outfit_combo",
      bundle_title: "Run Kit",
      items: [{ product_id: "tee-100", variant_id: "hallucinated-999", quantity: 1 }],
    },
    DEMO_PRODUCTS,
    { currency_symbol: "USD" }
  );
  assert.equal(invalidRes.applied_count, 0);
  assert.equal(invalidRes.rejected_items[0].reason, "invalid_variant_id");
  assert.equal(invalidRes.rejected_items[0].available_variants.length, 2);

  const oosRes = createCartBundle(
    {
      items: [{ product_id: "tee-100", variant_id: "v-tee-xl", quantity: 1 }],
    },
    DEMO_PRODUCTS,
    { currency_symbol: "USD" }
  );
  assert.equal(oosRes.rejected_items[0].reason, "variant_out_of_stock");

  const valid = createCartBundle(
    {
      items: [{ product_id: "tee-100", variant_id: "v-tee-m", quantity: 2 }],
    },
    DEMO_PRODUCTS,
    { currency_symbol: "USD" }
  );
  assert.equal(valid.applied_count, 1);
  assert.equal(valid.bundle.total_price, 90);

  // Failed atomic replace must preserve the original item in the cart
  const failedReplace = modifyCart(
    valid.bundle,
    {
      operations: [
        {
          action: "replace",
          replace_product_id: "tee-100",
          product_id: "shoe-200",
          variant_id: "bad-size",
        },
      ],
    },
    DEMO_PRODUCTS,
    { currency_symbol: "USD" }
  );
  assert.equal(failedReplace.applied_count, 0);
  assert.equal(failedReplace.rejected_ops[0].reason, "invalid_variant_id");
  assert.equal(failedReplace.bundle.items[0].external_id, "tee-100");
  assert.equal(failedReplace.bundle.items[0].variant_id, "v-tee-m");

  // Valid atomic replace swaps cleanly
  const okReplace = modifyCart(
    valid.bundle,
    {
      operations: [
        {
          action: "replace",
          replace_product_id: "tee-100",
          product_id: "shoe-200",
          variant_id: "v-shoe-42",
          quantity: 1,
        },
      ],
    },
    DEMO_PRODUCTS,
    { currency_symbol: "USD" }
  );
  assert.equal(okReplace.applied_count, 1);
  assert.equal(okReplace.bundle.items[0].external_id, "shoe-200");
  assert.equal(okReplace.bundle.total_price, 160);
});

test("Bounded ReAct Loop: static ACI prefix, concurrent Promise.all reads, same-turn self-correction, and graceful wrap-up", async () => {
  const executionTimeline = [];
  const toolDeclarationsSeen = [];
  let cartState = null;

  const registry = createToolRegistry([
    {
      mode: "read",
      declaration: { name: "search_catalog", parametersJsonSchema: { type: "object", additionalProperties: false, properties: { intent: { type: "string" }, query: { type: "string" } }, required: ["intent", "query"] } },
      execute: async (args) => {
        executionTimeline.push(`read_start:${args.query}`);
        await new Promise((r) => setTimeout(r, 15));
        executionTimeline.push(`read_end:${args.query}`);
        return { status: "ok", products: DEMO_PRODUCTS };
      },
    },
    {
      mode: "write",
      declaration: { name: "create_cart_bundle", parametersJsonSchema: { type: "object", additionalProperties: false, properties: { items: { type: "array" } }, required: ["items"] } },
      execute: async (args) => {
        executionTimeline.push("write:create_cart_bundle");
        const res = createCartBundle(args, DEMO_PRODUCTS, { currency_symbol: "USD" });
        if (res.bundle) cartState = res.bundle;
        return res;
      },
    },
  ]);

  let turn = 0;
  const stubProvider = {
    async chat(req) {
      toolDeclarationsSeen.push(req.tools ? req.tools.map((t) => t.name) : null);
      turn += 1;
      if (turn === 1) {
        // Two parallel reads in a single model step
        return {
          functionCalls: [
            { name: "search_catalog", args: { intent: "find tee", query: "tee" } },
            { name: "search_catalog", args: { intent: "find shoe", query: "shoe" } },
          ],
          rawParts: [
            { functionCall: { name: "search_catalog", args: { intent: "find tee", query: "tee" } }, thoughtSignature: "sig_1" },
            { functionCall: { name: "search_catalog", args: { intent: "find shoe", query: "shoe" } }, thoughtSignature: "sig_2" },
          ],
        };
      }
      if (turn === 2) {
        // Model emits an invalid variant first -> backend fails loudly with available_variants
        return {
          functionCalls: [
            { name: "create_cart_bundle", args: { items: [{ product_id: "tee-100", variant_id: "invalid-v" }] } },
          ],
        };
      }
      if (turn === 3) {
        // Model self-corrects from tool feedback in the next ReAct step
        return {
          functionCalls: [
            { name: "create_cart_bundle", args: { items: [{ product_id: "tee-100", variant_id: "v-tee-m" }] } },
          ],
        };
      }
      return {
        text: 'Your Medium Performance Running Tee is ready in the cart.<quick_replies>["Add shoes", "Checkout"]</quick_replies>',
        functionCalls: [],
      };
    },
  };

  const result = await runBoundedAgentLoop({
    llmProvider: stubProvider,
    contents: [{ role: "user", parts: [{ text: "Create a running tee cart in Medium" }] }],
    systemPrompt: "Test system",
    registry,
    maxSteps: 6,
  });

  assert.equal(result.ok, true);
  assert.equal(cartState?.items?.[0]?.variant_id, "v-tee-m");
  assert.deepEqual(result.quickReplies, ["Add shoes", "Checkout"]);

  // Both read_starts happen before either read_end (proving Promise.all concurrency)
  assert.equal(executionTimeline[0].startsWith("read_start:"), true);
  assert.equal(executionTimeline[1].startsWith("read_start:"), true);

  // Static prefix invariance: all tool-enabled calls receive the exact same tool declarations
  for (const decls of toolDeclarationsSeen) {
    assert.deepEqual(decls, ["search_catalog", "create_cart_bundle"]);
  }

  // Verify thoughtSignature preserved verbatim inside working history
  const firstModelTurn = result.contents.find((c) => c.role === "model");
  assert.equal(firstModelTurn.parts[0].thoughtSignature, "sig_1");

  // Graceful wrap-up test when hitting maxSteps = 1
  const wrapUpCalls = [];
  const loopProvider = {
    async chat(req) {
      wrapUpCalls.push(req.tools);
      if (req.tools) {
        return { functionCalls: [{ name: "search_catalog", args: { intent: "q", query: "tee" } }] };
      }
      return { text: "Summary from existing context." };
    },
  };
  const capped = await runBoundedAgentLoop({
    llmProvider: loopProvider,
    contents: [{ role: "user", parts: [{ text: "Search tee" }] }],
    systemPrompt: "Test",
    registry,
    maxSteps: 1,
  });
  assert.equal(capped.ok, true);
  assert.equal(capped.assistantMessage, "Summary from existing context.");
  assert.equal(wrapUpCalls[1], null);
});
