/**
 * Fail-Loud Deterministic Cart & Bundle Mutation Engine.
 * Rejects invalid or out-of-stock explicit variants with `available_variants[]`
 * so the ReAct loop self-corrects within the same turn, and validates `replace` atomically.
 */

function getEffectiveProductPrice(prod) {
  const base = Number(prod?.price || 0);
  if (base > 0) return base;
  const variants = Array.isArray(prod?.variants) ? prod.variants : [];
  const firstAvail = variants.find((v) => v && v.available !== false && Number(v.price) > 0);
  return firstAvail ? Number(firstAvail.price) : 0;
}

function formatAvailableVariants(prod, maxCount = 8) {
  const variants = Array.isArray(prod?.variants) ? prod.variants : [];
  return variants
    .filter((v) => v && v.available !== false)
    .slice(0, maxCount)
    .map((v) => ({
      variant_id: String(v.id),
      title: v.title || "Standard",
      price: Number(v.price || prod.price || 0),
      options: v.options || undefined,
    }));
}

function buildProductLookupMaps(products = []) {
  const byId = new Map();
  const byExternalId = new Map();
  for (const p of products || []) {
    if (!p) continue;
    if (p.id !== undefined && p.id !== null) byId.set(String(p.id), p);
    if (p.external_id !== undefined && p.external_id !== null) byExternalId.set(String(p.external_id), p);
  }
  return { byId, byExternalId };
}

function resolveProduct(maps, rawPid) {
  const key = String(rawPid || "").trim();
  if (!key) return null;
  return maps.byId.get(key) || maps.byExternalId.get(key) || null;
}

/**
 * Strictly validates an explicit `variant_id` against the product's variants list.
 * Fail-loud: never silently downgrades invalid explicit variant IDs to `variants[0]`.
 */
export function validateExplicitVariant(prod, requestedVariantId) {
  const vidStr = String(requestedVariantId ?? "").trim();
  const variants = Array.isArray(prod?.variants) ? prod.variants : [];
  const availableVariants = formatAvailableVariants(prod);

  if (variants.length === 0) {
    if (!vidStr || vidStr === String(prod.variant_id || prod.external_id || prod.id)) {
      return {
        ok: true,
        variant_id: String(prod.variant_id || prod.external_id || prod.id),
        unit_price: Number(prod.price || 0),
        variant_title: null,
        availableVariants,
      };
    }
    return {
      ok: false,
      reason: "invalid_variant_id",
      detail: `Product '${prod.title}' has no selectable variant '${vidStr}'.`,
      availableVariants,
    };
  }

  const matched = variants.find((v) => {
    if (!v) return false;
    return String(v.id) === vidStr || (v.sku && String(v.sku) === vidStr);
  });

  if (!matched) {
    return {
      ok: false,
      reason: "invalid_variant_id",
      detail: `Variant '${vidStr}' does not exist for '${prod.title}'. Choose a valid variant_id from available_variants.`,
      availableVariants,
    };
  }

  if (matched.available === false) {
    return {
      ok: false,
      reason: "variant_out_of_stock",
      detail: `Variant '${matched.title || vidStr}' of '${prod.title}' is out of stock. Choose an available variant from available_variants.`,
      availableVariants,
    };
  }

  return {
    ok: true,
    variant_id: String(matched.id),
    unit_price: Number(matched.price || prod.price || 0),
    variant_title: matched.title || null,
    availableVariants,
  };
}

export function validateCatalogAddition(prod, requestedPid, requestedVariantId) {
  if (!prod) {
    return {
      ok: false,
      reason: "not_found",
      detail: `product_id '${requestedPid}' not found in catalog. Re-check IDs from search_catalog.`,
    };
  }

  const hasVariantStock = Array.isArray(prod.variants) && prod.variants.some((v) => v && v.available !== false);
  const isInStock = prod.in_stock === 1 || prod.in_stock === true || hasVariantStock;
  if (!isInStock) {
    return {
      ok: false,
      reason: "out_of_stock",
      detail: `'${prod.title}' (id:${prod.external_id || prod.id}) is currently out of stock.`,
    };
  }

  const vidStr = String(requestedVariantId ?? "").trim();
  if (vidStr) {
    return validateExplicitVariant(prod, vidStr);
  }

  const availableVariants = formatAvailableVariants(prod);
  const firstAvail = availableVariants[0] || null;
  const fallbackVid = firstAvail?.variant_id || String(prod.variant_id || prod.external_id || prod.id);
  const unitPrice = firstAvail ? Number(firstAvail.price) : getEffectiveProductPrice(prod);

  return {
    ok: true,
    variant_id: fallbackVid,
    unit_price: unitPrice,
    variant_title: firstAvail && firstAvail.title !== "Standard" ? firstAvail.title : null,
    availableVariants,
  };
}

function makeBundleItem(prod, validation, qty, reason) {
  const unitPrice = Number(validation.unit_price || 0);
  const vTitle = validation.variant_title;
  const baseTitle = prod.title || "Product";
  const displayTitle =
    vTitle && vTitle !== "Default Title" && vTitle !== "Standard" && !baseTitle.toLowerCase().includes(vTitle.toLowerCase())
      ? `${baseTitle} (${vTitle})`
      : baseTitle;

  return {
    product_id: String(prod.id ?? prod.external_id),
    external_id: String(prod.external_id || prod.id),
    variant_id: String(validation.variant_id),
    title: displayTitle,
    base_title: baseTitle,
    variant_title: vTitle || null,
    available_variants: Array.isArray(validation.availableVariants) ? validation.availableVariants : [],
    brand: prod.brand || "",
    category: prod.category || "general",
    quantity: qty,
    unit_price: unitPrice,
    line_total: Math.round(unitPrice * qty * 100) / 100,
    usage_note: reason || (prod.category !== "general" ? prod.category : "Selected Item"),
  };
}

function buildBundleObject({ bundleType, bundleTitle, bundleSummary, items, currency = "USD" }) {
  const totalPrice = Math.round(
    items.reduce((sum, it) => sum + Number(it.line_total || it.unit_price * it.quantity || 0), 0) * 100
  ) / 100;

  return {
    bundle_type: bundleType || "custom_bundle",
    bundle_title: bundleTitle || "Custom Bundle",
    bundle_summary: bundleSummary || "",
    currency,
    total_price: totalPrice,
    item_count: items.length,
    items,
  };
}

export function createCartBundle(args, products = [], shop = {}) {
  const maps = buildProductLookupMaps(products);
  const currency = shop?.currency_symbol || "USD";
  const rawItems = Array.isArray(args?.items) ? args.items : [];
  const nextItems = [];
  const rejectedItems = [];

  for (const raw of rawItems) {
    const pid = String(raw?.product_id || "").trim();
    const vid = raw?.variant_id !== undefined && raw?.variant_id !== null ? String(raw.variant_id).trim() : "";
    const qty = Math.min(Math.max(parseInt(raw?.quantity || 1, 10) || 1, 1), 99);
    const reason = String(raw?.reason || "").trim();

    const prod = resolveProduct(maps, pid);
    const check = validateCatalogAddition(prod, pid, vid);
    if (!check.ok) {
      rejectedItems.push({
        product_id: pid,
        variant_id: vid || null,
        reason: check.reason,
        detail: check.detail,
        available_variants: check.availableVariants || [],
      });
      continue;
    }

    const existing = nextItems.find(
      (it) => it.external_id === String(prod.external_id || prod.id) && it.variant_id === check.variant_id
    );
    if (existing) {
      existing.quantity = Math.min(existing.quantity + qty, 99);
      existing.line_total = Math.round(existing.unit_price * existing.quantity * 100) / 100;
      if (reason) existing.usage_note = reason;
    } else {
      nextItems.push(makeBundleItem(prod, check, qty, reason));
    }
  }

  if (nextItems.length === 0) {
    return { bundle: null, applied_count: 0, rejected_items: rejectedItems };
  }

  return {
    bundle: buildBundleObject({
      bundleType: args?.bundle_type || "custom_bundle",
      bundleTitle: args?.bundle_title || "Personalized Bundle",
      bundleSummary: args?.bundle_summary || "",
      items: nextItems,
      currency,
    }),
    applied_count: nextItems.length,
    rejected_items: rejectedItems,
  };
}

function findCartItemIndex(items, targetPid, targetVid) {
  const pidStr = String(targetPid || "").trim();
  const vidStr = String(targetVid || "").trim();
  if (!pidStr) return -1;

  if (vidStr) {
    const exact = items.findIndex(
      (it) => (String(it.product_id) === pidStr || String(it.external_id) === pidStr) && String(it.variant_id) === vidStr
    );
    if (exact !== -1) return exact;
  }
  return items.findIndex((it) => String(it.product_id) === pidStr || String(it.external_id) === pidStr);
}

export function modifyCart(existingBundle, args, products = [], shop = {}) {
  const maps = buildProductLookupMaps(products);
  const currency = shop?.currency_symbol || "USD";
  const ops = Array.isArray(args?.operations) ? args.operations : [];
  let items = existingBundle && Array.isArray(existingBundle.items)
    ? existingBundle.items.map((it) => ({ ...it }))
    : [];

  if (items.length === 0 && !ops.some((o) => o?.action === "add")) {
    return { empty_cart: true, bundle: null, applied_count: 0, rejected_ops: [] };
  }

  let appliedCount = 0;
  const rejectedOps = [];

  for (const op of ops) {
    const action = String(op?.action || "").toLowerCase();
    const pid = String(op?.product_id || "").trim();
    const vid = op?.variant_id !== undefined && op?.variant_id !== null ? String(op.variant_id).trim() : "";
    const qty = parseInt(op?.quantity ?? 1, 10);
    const reason = String(op?.reason || "").trim();

    if (action === "clear") {
      items = [];
      appliedCount++;
      continue;
    }

    if (action === "remove") {
      const idx = findCartItemIndex(items, pid, vid);
      if (idx !== -1) {
        items.splice(idx, 1);
        appliedCount++;
      } else {
        rejectedOps.push({
          action,
          product_id: pid,
          reason: "not_in_cart",
          detail: `product_id '${pid}' not found in current cart.`,
        });
      }
      continue;
    }

    if (action === "set_quantity") {
      const idx = findCartItemIndex(items, pid, vid);
      if (idx === -1) {
        rejectedOps.push({
          action,
          product_id: pid,
          reason: "not_in_cart",
          detail: `product_id '${pid}' not found in current cart.`,
        });
        continue;
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        items.splice(idx, 1);
      } else {
        const clamped = Math.min(qty, 99);
        items[idx].quantity = clamped;
        items[idx].line_total = Math.round(items[idx].unit_price * clamped * 100) / 100;
      }
      appliedCount++;
      continue;
    }

    if (action === "replace") {
      const targetReplacePid = String(op?.replace_product_id || pid || "").trim();
      const targetReplaceVid = op?.replace_variant_id !== undefined && op?.replace_variant_id !== null
        ? String(op.replace_variant_id).trim()
        : "";
      const oldIdx = findCartItemIndex(items, targetReplacePid, targetReplaceVid);
      if (oldIdx === -1) {
        rejectedOps.push({
          action,
          product_id: pid,
          replace_product_id: targetReplacePid,
          reason: "not_in_cart",
          detail: `Item '${targetReplacePid}' to replace is not in the cart.`,
        });
        continue;
      }

      // Atomic validation: validate replacement BEFORE removing the existing item
      const newProd = resolveProduct(maps, pid);
      const check = validateCatalogAddition(newProd, pid, vid);
      if (!check.ok) {
        rejectedOps.push({
          action,
          product_id: pid,
          variant_id: vid || null,
          reason: check.reason,
          detail: check.detail,
          available_variants: check.availableVariants || [],
        });
        continue;
      }

      const oldItem = items[oldIdx];
      const finalQty = Number.isFinite(qty) && qty > 0 ? Math.min(qty, 99) : oldItem.quantity || 1;
      items.splice(oldIdx, 1, makeBundleItem(newProd, check, finalQty, reason || oldItem.usage_note));
      appliedCount++;
      continue;
    }

    if (action === "add") {
      const prod = resolveProduct(maps, pid);
      const check = validateCatalogAddition(prod, pid, vid);
      if (!check.ok) {
        rejectedOps.push({
          action,
          product_id: pid,
          variant_id: vid || null,
          reason: check.reason,
          detail: check.detail,
          available_variants: check.availableVariants || [],
        });
        continue;
      }

      const safeQty = Number.isFinite(qty) && qty > 0 ? Math.min(qty, 99) : 1;
      const existing = items.find(
        (it) => it.external_id === String(prod.external_id || prod.id) && it.variant_id === check.variant_id
      );
      if (existing) {
        existing.quantity = Math.min(existing.quantity + safeQty, 99);
        existing.line_total = Math.round(existing.unit_price * existing.quantity * 100) / 100;
        if (reason) existing.usage_note = reason;
      } else {
        items.push(makeBundleItem(prod, check, safeQty, reason));
      }
      appliedCount++;
    }
  }

  if (items.length === 0) {
    return { empty_cart: false, bundle: null, applied_count: appliedCount, rejected_ops: rejectedOps };
  }

  return {
    empty_cart: false,
    bundle: buildBundleObject({
      bundleType: existingBundle?.bundle_type || "custom_bundle",
      bundleTitle: existingBundle?.bundle_title || "Updated Cart",
      bundleSummary: existingBundle?.bundle_summary || "",
      items,
      currency,
    }),
    applied_count: appliedCount,
    rejected_ops: rejectedOps,
  };
}
