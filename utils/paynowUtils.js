// paynowUtils.js
const axios = require("axios");

/**
 * PayNow configuration
 *
 * PAYNOW_API_KEY should be in the format: "APIKey TOKEN_HERE"
 * as required by the PayNow Management API.
 * PAYNOW_STORE_ID can be set in env; falls back to your provided store ID.
 */
const PAYNOW_API_KEY = process.env.PAYNOW_API_KEY || null;
const PAYNOW_STORE_ID =
  process.env.PAYNOW_STORE_ID || "304676382217084928";
const PAYNOW_BASE_URL =
  process.env.PAYNOW_BASE_URL || "https://api.paynow.gg";

/**
 * Max number of expired products to show in the INVENTORY section.
 */
const MAX_EXPIRED_ITEMS =
  parseInt(process.env.PAYNOW_MAX_EXPIRED || "3", 10) || 3;

/**
 * Format slug into human-readable name.
 * Example:
 *  "all-kits-global-monthly" => "All Kits Global Monthly"
 *  "vip-rf" => "Vip Random Farming"
 */
function formatProductSlug(slug) {
  if (!slug || typeof slug !== "string") return "Unknown Product";

  const parts = slug.split("-");

  const formatted = parts.map((word) => {
    if (!word) return "";
    if (word.toLowerCase() === "rf") {
      return "Random Farming";
    }
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });

  return formatted.join(" ").trim() || "Unknown Product";
}

/**
 * Utility: safely read a product slug from a delivery item.
 * We try multiple possible shapes to be robust against schema changes.
 */
function getProductSlugFromItem(item) {
  if (!item || typeof item !== "object") return null;

  // Common possibilities – adjust if your schema differs
  if (item.product && typeof item.product.slug === "string") {
    return item.product.slug;
  }
  if (typeof item.product_slug === "string") {
    return item.product_slug;
  }
  if (typeof item.productSlug === "string") {
    return item.productSlug;
  }

  // fallback: product id as slug
  if (item.product && typeof item.product.id === "string") {
    return item.product.id;
  }
  if (typeof item.product_id === "string") {
    return item.product_id;
  }

  return null;
}

/**
 * Compute relative days between now and a given ISO datetime string.
 * Returns: { type: "future"|"past"|"now", days: number } or null on error.
 */
function diffFromNowInDays(dateString) {
  if (!dateString) return null;
  const target = new Date(dateString);
  if (Number.isNaN(target.getTime())) return null;

  const now = new Date();
  const diffMs = target.getTime() - now.getTime();
  const diffDays = Math.round(Math.abs(diffMs) / 86400000);

  if (diffMs > 0) return { type: "future", days: diffDays };
  if (diffMs < 0) return { type: "past", days: diffDays };
  return { type: "now", days: 0 };
}

/**
 * Build a human-readable expiry label.
 * If no expiry, treat as lifetime.
 */
function formatExpiryLabel(item, isExpired) {
  const expiresAt =
    item?.expires_at || item?.expiresAt || item?.override_expires_at;

  if (!expiresAt) {
    return "Lifetime";
  }

  const diff = diffFromNowInDays(expiresAt);
  if (!diff) return "Unknown expiry";

  if (isExpired || diff.type === "past") {
    if (diff.days === 0) return "expired today";
    if (diff.days === 1) return "expired 1 day ago";
    return `expired ${diff.days} days ago`;
  }

  // future or now
  if (diff.days === 0) return "expires today";
  if (diff.days === 1) return "expires in 1 day";
  return `expires in ${diff.days} days`;
}

/**
 * Decide whether an item is active or expired.
 * Prefer explicit status, fall back to expires_at where needed.
 */
function classifyItem(item) {
  const status = (item?.status || "").toLowerCase();
  const expiresAt =
    item?.expires_at || item?.expiresAt || item?.override_expires_at;
  const now = new Date();

  if (status === "active") return "active";
  if (
    status === "expired" ||
    status === "revoked" ||
    status === "cancelled" ||
    status === "canceled" ||
    status === "refunded" ||
    status === "chargeback"
  ) {
    return "expired";
  }

  if (expiresAt) {
    const exp = new Date(expiresAt);
    if (!Number.isNaN(exp.getTime())) {
      return exp.getTime() >= now.getTime() ? "active" : "expired";
    }
  }

  // Default to active if uncertain
  return "active";
}

/**
 * Split items into { activeItems, expiredItems } and sort them.
 */
function splitActiveAndExpired(items) {
  const activeItems = [];
  const expiredItems = [];

  if (!Array.isArray(items)) {
    return { activeItems, expiredItems };
  }

  for (const item of items) {
    const classification = classifyItem(item);
    if (classification === "active") {
      activeItems.push(item);
    } else {
      expiredItems.push(item);
    }
  }

  const getExpiryDate = (i) =>
    new Date(
      i?.expires_at || i?.expiresAt || i?.override_expires_at || i?.created_at,
    );

  // Active: sort by expiry asc (soonest first)
  activeItems.sort((a, b) => getExpiryDate(a) - getExpiryDate(b));
  // Expired: sort by expiry desc (most recent first)
  expiredItems.sort((a, b) => getExpiryDate(b) - getExpiryDate(a));

  return { activeItems, expiredItems };
}

/**
 * Build embed fields for INVENTORY section.
 * Returns an array of Discord embed fields.
 */
function buildInventoryFieldsFromItems(activeItems, expiredItems) {
  const fields = [];

  // ACTIVE
  if (activeItems && activeItems.length > 0) {
    const lines = activeItems.map((item) => {
      const slug = getProductSlugFromItem(item);
      const productName = formatProductSlug(slug);
      const expiryLabel = formatExpiryLabel(item, false);
      return `• ${productName} (${expiryLabel})`;
    });

    fields.push({
      name: "Active Products",
      value: lines.join("\n"),
      inline: false,
    });
  }

  // EXPIRED (limit to MAX_EXPIRED_ITEMS)
  const expiredToShow =
    expiredItems && expiredItems.length > MAX_EXPIRED_ITEMS
      ? expiredItems.slice(0, MAX_EXPIRED_ITEMS)
      : expiredItems || [];

  if (expiredToShow.length > 0) {
    const lines = expiredToShow.map((item) => {
      const slug = getProductSlugFromItem(item);
      const productName = formatProductSlug(slug);
      const expiryLabel = formatExpiryLabel(item, true);
      return `• ${productName} — ${expiryLabel}`;
    });

    fields.push({
      name: "Recently Expired",
      value: lines.join("\n"),
      inline: false,
    });
  }

  if (fields.length === 0) {
    fields.push({
      name: "Inventory",
      value: "No products found for this customer.",
      inline: false,
    });
  }

  return fields;
}

/**
 * Low-level: Lookup PayNow customer by SteamID.
 *
 * GET /v1/stores/{storeId}/customers/lookup?steam_id=<steam64>
 */
async function lookupCustomerBySteamId(steamId) {
  if (!PAYNOW_API_KEY || !PAYNOW_STORE_ID || !steamId) return null;

  try {
    const url = `${PAYNOW_BASE_URL}/v1/stores/${PAYNOW_STORE_ID}/customers/lookup`;

    const resp = await axios.get(url, {
      params: {
        steam_id: steamId,
      },
      headers: {
        Authorization: PAYNOW_API_KEY,
        Accept: "*/*",
      },
    });

    if (!resp?.data || !resp.data.id) return null;
    return resp.data; // full customer object
  } catch (err) {
    console.error("[PayNow] lookupCustomerBySteamId error:", err.message || err);
    return null;
  }
}

/**
 * Low-level: Get all delivery items for a PayNow customer.
 *
 * GET /v1/stores/{storeId}/customers/{customerId}/delivery/items
 */
async function getCustomerDeliveryItems(customerId) {
  if (!PAYNOW_API_KEY || !PAYNOW_STORE_ID || !customerId) return [];

  try {
    const url = `${PAYNOW_BASE_URL}/v1/stores/${PAYNOW_STORE_ID}/customers/${customerId}/delivery/items`;

    const resp = await axios.get(url, {
      params: {
        limit: 100,
        asc: false,
      },
      headers: {
        Authorization: PAYNOW_API_KEY,
        Accept: "*/*",
      },
    });

    if (!Array.isArray(resp?.data)) return [];
    return resp.data;
  } catch (err) {
    console.error(
      "[PayNow] getCustomerDeliveryItems error:",
      err.message || err,
    );
    return [];
  }
}

/**
 * High-level helper used by ticketCreate:
 * Given a SteamID64, fetch PayNow customer and their inventory.
 *
 * Returns:
 * {
 *   activeItems: [...],
 *   expiredItems: [...]
 * }
 */
async function fetchCustomerInventoryForSteam(steamId) {
  if (!steamId) return null;

  const customer = await lookupCustomerBySteamId(steamId);
  if (!customer?.id) return null;

  const items = await getCustomerDeliveryItems(customer.id);
  const { activeItems, expiredItems } = splitActiveAndExpired(items);

  return { activeItems, expiredItems };
}

module.exports = {
  formatProductSlug,
  buildInventoryFieldsFromItems,
  fetchCustomerInventoryForSteam,
};
