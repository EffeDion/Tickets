// paynowUtils.js
const axios = require("axios");

// ENV + defaults
const PAYNOW_API_KEY = process.env.PAYNOW_API_KEY || null;
// You gave this store ID; you can override via env if you like.
const PAYNOW_STORE_ID =
  process.env.PAYNOW_STORE_ID || "304676382217084928";
const PAYNOW_BASE_URL =
  process.env.PAYNOW_BASE_URL || "https://api.paynow.gg";

// How many expired products to show in "Recently Expired"
const MAX_EXPIRED_ITEMS =
  parseInt(process.env.PAYNOW_MAX_EXPIRED || "3", 10) || 3;

/**
 * Turn a slug like "all-kits-global-monthly" into
 * "All Kits Global Monthly" with special-case:
 *   "rf" -> "Random Farming"
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

  const joined = formatted.join(" ").trim();
  return joined || "Unknown Product";
}

/**
 * Safely pull the product slug out of a delivery item.
 * Your sample shows: item.product.slug
 */
function getProductSlugFromItem(item) {
  if (!item || typeof item !== "object") return null;

  if (item.product && typeof item.product.slug === "string") {
    return item.product.slug;
  }
  if (typeof item.product_slug === "string") return item.product_slug;
  if (typeof item.productSlug === "string") return item.productSlug;

  // fallback: try product.name if there is no slug
  if (item.product && typeof item.product.name === "string") {
    return item.product.name.replace(/\s+/g, "-").toLowerCase();
  }

  return null;
}

/**
 * Compute difference in days between now and some ISO date string.
 * Returns: { type: "future" | "past" | "now", days: number } or null.
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
 * Build an expiry label, e.g.:
 *  - "Lifetime"
 *  - "expires in 21 days"
 *  - "expired 12 days ago"
 */
function formatExpiryLabel(item, forceExpired = false) {
  const expiresAt =
    item?.override_expires_at || item?.expires_at || null;
  const expirable = item?.expirable === true;

  // Non-expiring or unknown → Lifetime
  if (!expiresAt || !expirable) {
    if (forceExpired) return "expired";
    return "Lifetime";
  }

  const diff = diffFromNowInDays(expiresAt);
  if (!diff) return forceExpired ? "expired" : "Unknown expiry";

  const isPast = diff.type === "past" || forceExpired;

  if (isPast) {
    if (diff.days === 0) return "expired today";
    if (diff.days === 1) return "expired 1 day ago";
    return `expired ${diff.days} days ago`;
  }

  // future / now
  if (diff.days === 0) return "expires today";
  if (diff.days === 1) return "expires in 1 day";
  return `expires in ${diff.days} days`;
}

/**
 * Basic classification of an item as active/expired using "state"
 * and expiry timestamps.
 *
 * From your example:
 *   state: "usable" => active
 *   anything else => expired
 */
function classifyItem(item) {
  const state = (item?.state || "").toLowerCase();
  const expiresAt =
    item?.override_expires_at || item?.expires_at || null;

  if (state === "usable") {
    if (!expiresAt) return "active";

    const diff = diffFromNowInDays(expiresAt);
    if (!diff || diff.type === "future" || diff.type === "now") {
      return "active";
    }
    return "expired";
  }

  // not usable → treat as expired
  return "expired";
}

/**
 * Split array of items into { activeItems, expiredItems } and sort.
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

  const getRelevantDate = (i) =>
    new Date(
      i?.override_expires_at ||
        i?.expires_at ||
        i?.added_at ||
        i?.created_at ||
        0,
    );

  // Active: sort by expiry ascending (soonest first)
  activeItems.sort((a, b) => getRelevantDate(a) - getRelevantDate(b));
  // Expired: sort by expiry descending (most recent first)
  expiredItems.sort((a, b) => getRelevantDate(b) - getRelevantDate(a));

  return { activeItems, expiredItems };
}

/**
 * Build Discord embed fields from active/expired delivery items.
 *
 * OUTPUT:
 *  - "Active Products" field
 *  - "Recently Expired" field (up to MAX_EXPIRED_ITEMS)
 */
function buildInventoryFieldsFromItems(activeItems, expiredItems) {
  const fields = [];

  // ACTIVE
  if (Array.isArray(activeItems) && activeItems.length > 0) {
    const lines = activeItems.map((item) => {
      const slug = getProductSlugFromItem(item);
      const nameFromSlug = formatProductSlug(slug);
      const expiryLabel = formatExpiryLabel(item, false);
      return `• ${nameFromSlug} (${expiryLabel})`;
    });

    fields.push({
      name: "Active Products",
      value: lines.join("\n"),
      inline: false,
    });
  }

  // EXPIRED
  let expiredToShow = Array.isArray(expiredItems) ? expiredItems : [];
  if (expiredToShow.length > MAX_EXPIRED_ITEMS) {
    expiredToShow = expiredToShow.slice(0, MAX_EXPIRED_ITEMS);
  }

  if (expiredToShow.length > 0) {
    const lines = expiredToShow.map((item) => {
      const slug = getProductSlugFromItem(item);
      const nameFromSlug = formatProductSlug(slug);
      const expiryLabel = formatExpiryLabel(item, true);
      return `• ${nameFromSlug} — ${expiryLabel}`;
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
 * Lookup a PayNow customer by SteamID64.
 *
 * GET /v1/stores/{storeId}/customers/lookup?steam_id=<steam64>
 *
 * Response is a CustomerDto object.
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
        Authorization: `APIKey ${PAYNOW_API_KEY}`,
        Accept: "*/*",
        },
    });

    const customer = resp.data;
    if (!customer || !customer.id) {
      return null;
    }

    return customer; // CustomerDto
  } catch (err) {
    console.error(
      "[PayNow] lookupCustomerBySteamId error:",
      err.response?.data || err.message || err,
    );
    return null;
  }
}

/**
 * Get delivery items for a specific customer.
 *
 * GET /v1/stores/{storeId}/customers/{customerId}/delivery/items
 *
 * Returns an array of DeliveryItemDto (your example).
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
        Authorization: `APIKey ${PAYNOW_API_KEY}`,
        Accept: "*/*",
        },
    });

    if (!Array.isArray(resp.data)) return [];
    return resp.data;
  } catch (err) {
    console.error(
      "[PayNow] getCustomerDeliveryItems error:",
      err.response?.data || err.message || err,
    );
    return [];
  }
}

/**
 * High-level helper:
 *  1) Lookup customer by SteamID
 *  2) Fetch their delivery items
 *  3) Split into active/expired
 */
async function fetchCustomerInventoryForSteam(steamId) {
  if (!steamId) return null;

  const customer = await lookupCustomerBySteamId(steamId);
  if (!customer || !customer.id) return null;

  const items = await getCustomerDeliveryItems(customer.id);
  const { activeItems, expiredItems } = splitActiveAndExpired(items);

  return { activeItems, expiredItems };
}

module.exports = {
  formatProductSlug,
  buildInventoryFieldsFromItems,
  fetchCustomerInventoryForSteam,
};
