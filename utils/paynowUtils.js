// paynowUtils.js
const axios = require("axios");

// -------------------------------------------------------------------
// ENV CONFIG
// -------------------------------------------------------------------

/**
 * PAYNOW_API_KEY must be the raw key, e.g.
 * pnapi_v1_XXXXXXXXXXXXXXXXXXXXXXXX
 *
 * It is sent as: Authorization: APIKey <PAYNOW_API_KEY>
 */
const PAYNOW_API_KEY = process.env.PAYNOW_API_KEY || null;
const PAYNOW_STORE_ID =
  process.env.PAYNOW_STORE_ID || "304676382217084928";
const PAYNOW_BASE_URL =
  process.env.PAYNOW_BASE_URL || "https://api.paynow.gg";

// How many expired products to show in "Recently Expired"
const MAX_EXPIRED_ITEMS =
  parseInt(process.env.PAYNOW_MAX_EXPIRED || "3", 10) || 3;

// -------------------------------------------------------------------
// PARSING / NAMING RULES (EDIT THESE TO CUSTOMIZE WORDING)
// -------------------------------------------------------------------

/**
 * Server tokens → pretty names
 * (used to detect server from slug tokens)
 */
const SERVER_TOKENS = {
  global: "Global",
  "10x": "10x",
  rf: "Random Farming",
  boatwars: "Boat Wars",
  savas: "Savas",
};

/**
 * Word replacements for product name fragments.
 * Keys are lowercase tokens.
 */
const PRODUCT_WORD_REPLACEMENTS = {
  allkits: "All Kits",
  "all-kits": "All Kits",
  all: "All",
  kits: "Kits",
  builder: "Builder",
  pvp: "PvP",
  resource: "Resource",
  tools: "Tools",
  components: "Components",
  pirate: "Pirate",
  captain: "Captain",
  elite: "Elite",
  god: "God",
  turret: "Turret",

  vip: "VIP",
  vipplus: "VIP+",

  credits: "Credits",

  name: "Name",
  color: "Color",

  tag: "Tag",

  gg: "GG",
};

/**
 * Runtime words are derived from tokens like:
 *  - permanent, lifetime
 *  - monthly, weekly
 *  - 1-year, 6-months, 3-months, etc.
 *
 * We parse them dynamically in parseRuntimeFromToken().
 */

// -------------------------------------------------------------------
// GENERIC HELPERS
// -------------------------------------------------------------------

function isNumericToken(token) {
  return /^\d+$/.test(token);
}

/**
 * Capitalize a token if there is no explicit replacement.
 */
function defaultCapitalize(word) {
  if (!word) return "";
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Compute days difference between now and a given ISO datetime.
 * Returns { type: "future" | "past" | "now", days } or null.
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

// -------------------------------------------------------------------
// RUNTIME PARSING (FROM SLUG TOKENS)
// -------------------------------------------------------------------

/**
 * Parse a single token into a runtime string (e.g. "Permanent", "1 Year", "6 Months").
 * Returns string or null if it doesn't look like a runtime token.
 */
function parseRuntimeFromToken(token) {
  if (!token) return null;
  const t = token.toLowerCase();

  if (t === "permanent" || t === "lifetime") return "Permanent";
  if (t === "monthly") return "Monthly";
  if (t === "weekly") return "Weekly";

  // 1-year, 1year, 2-years etc.
  let m = t.match(/^(\d+)-?year(s)?$/);
  if (m) {
    const num = parseInt(m[1], 10);
    return num === 1 ? "1 Year" : `${num} Years`;
  }

  // 6-months, 3-month, 12-months, etc.
  m = t.match(/^(\d+)-?month(s)?$/);
  if (m) {
    const num = parseInt(m[1], 10);
    return num === 1 ? "1 Month" : `${num} Months`;
  }

  return null;
}

/**
 * Build an "expiry label" based on timestamps.
 * For expired items we want something like "expired 329 days ago".
 * For active items we can ignore this (we don't show expiry for active).
 */
function formatExpiryLabel(item, forceExpired = false) {
  const expirable = item?.expirable === true;

  // Best timestamp to treat as "expiration" or "last valid":
  const expiresAt =
    item?.override_expires_at ||
    item?.expires_at ||
    item?.revoked_at ||
    item?.removed_at ||
    null;

  if (!expiresAt) {
    if (!expirable) return "lifetime";
    return forceExpired ? "expired" : "lifetime";
  }

  const diff = diffFromNowInDays(expiresAt);
  if (!diff) return forceExpired ? "expired" : "unknown";

  const isPast = diff.type === "past" || forceExpired;

  if (isPast) {
    if (diff.days === 0) return "Expired today";
    if (diff.days === 1) return "Expired 1 day ago";
    return `Expired ${diff.days} days ago`;
  }

  // future / now
  if (diff.days === 0) return "Expires today";
  if (diff.days === 1) return "Expires in 1 day";
  return `Expires in ${diff.days} days`;
}

// -------------------------------------------------------------------
// SLUG EXTRACTION
// -------------------------------------------------------------------

/**
 * Safely extract product slug from a delivery item.
 */
function getProductSlugFromItem(item) {
  if (!item || typeof item !== "object") return null;

  if (item.product && typeof item.product.slug === "string") {
    return item.product.slug;
  }
  if (typeof item.product_slug === "string") return item.product_slug;
  if (typeof item.productSlug === "string") return item.productSlug;

  // fallback: convert product.name to slug
  if (item.product && typeof item.product.name === "string") {
    return item.product.name.replace(/\s+/g, "-").toLowerCase();
  }

  return null;
}

// -------------------------------------------------------------------
// MAIN SLUG PARSER
// -------------------------------------------------------------------

/**
 * Parse a slug into structured info:
 *  - productName (string to display)
 *  - serverName (pretty string)
 *  - runtimeText (e.g. "Permanent", "1 Year")
 *  - kind: "generic" | "credits" | "tag" | "namecolor"
 *
 * This is where we apply custom layout rules.
 */
function parseProductSlug(slug) {
  if (!slug || typeof slug !== "string") {
    return {
      productName: "Unknown Product",
      serverName: "Global",
      runtimeText: null,
      kind: "generic",
    };
  }

  const lowerSlug = slug.toLowerCase();
  const tokens = lowerSlug.split("-").filter(Boolean);

  // ----------------------------------------------------------------
  // 1) Credits: "<amount>-credits"
  // ----------------------------------------------------------------
  if (tokens.includes("credits")) {
    const amountToken = tokens.find((t) => isNumericToken(t));
    const amount = amountToken || "";
    const productName = amount
      ? `${amount} Credits`
      : "Credits";

    return {
      productName,
      serverName: "Global",
      runtimeText: null,
      kind: "credits",
    };
  }

  // ----------------------------------------------------------------
  // 2) Tags: "<tag>-tag" (e.g. "gg-tag"), always global, no runtime
  // ----------------------------------------------------------------
  const tagIndex = tokens.indexOf("tag");
  if (tagIndex !== -1) {
    const prefixTokens = tokens.slice(0, tagIndex);
    const formattedPrefix = prefixTokens
      .map((t) => {
        const rep = PRODUCT_WORD_REPLACEMENTS[t];
        return rep || defaultCapitalize(t);
      })
      .filter(Boolean)
      .join(" ");

    const tagLabel = formattedPrefix
      ? `${formattedPrefix} Tag`
      : "Tag";

    return {
      productName: tagLabel,
      serverName: "Global",
      runtimeText: null,
      kind: "tag",
    };
  }

  // ----------------------------------------------------------------
  // 3) Name Color: "name-color" or "gold-name-color"
  // ----------------------------------------------------------------
  const nameIndex = tokens.indexOf("name");
  const colorIndex = tokens.indexOf("color");
  if (nameIndex !== -1 && colorIndex !== -1) {
    const prefixTokens = tokens.slice(0, nameIndex); // e.g. "gold"
    const prefixName = prefixTokens
      .map((t) => {
        const rep = PRODUCT_WORD_REPLACEMENTS[t];
        return rep || defaultCapitalize(t);
      })
      .filter(Boolean)
      .join(" ");

    const baseName = "Name Color";
    const productName = prefixName
      ? `${prefixName} ${baseName}`
      : baseName;

    return {
      productName,
      serverName: "Global",
      runtimeText: null,
      kind: "namecolor",
    };
  }

  // ----------------------------------------------------------------
  // 4) Generic items (kits, VIP, etc.)
  // ----------------------------------------------------------------

  let serverName = null;
  let runtimeText = null;

  // Copy tokens so we can remove server/runtime bits
  const remaining = [...tokens];

  // 4a) Detect server from known tokens
  for (let i = 0; i < remaining.length; i++) {
    const t = remaining[i];
    if (Object.prototype.hasOwnProperty.call(SERVER_TOKENS, t)) {
      serverName = SERVER_TOKENS[t];
      remaining.splice(i, 1);
      break;
    }
  }

  // 4b) Detect runtime from tokens (scan from the end)
  for (let i = remaining.length - 1; i >= 0; i--) {
    const t = remaining[i];
    const rt = parseRuntimeFromToken(t);
    if (rt) {
      runtimeText = rt;
      remaining.splice(i, 1);
      break;
    }
  }

  // 4c) Whatever is left are product name words
  const productTokens = remaining.filter(Boolean);

  const productName =
    productTokens
      .map((t) => {
        const rep = PRODUCT_WORD_REPLACEMENTS[t];
        if (rep) return rep;
        if (isNumericToken(t)) return t;
        return defaultCapitalize(t);
      })
      .join(" ")
      .trim() || "Unknown Product";

  return {
    productName,
    serverName: serverName || "Global",
    runtimeText,
    kind: "generic",
  };
}

// -------------------------------------------------------------------
// ITEM CLASSIFICATION (ACTIVE / EXPIRED)
// -------------------------------------------------------------------

/**
 * "usable" => active, everything else => expired.
 */
function classifyItem(item) {
  const state = (item?.state || "").toLowerCase();
  if (state === "usable") return "active";
  return "expired";
}

/**
 * Split items into active vs expired, preserving PayNow order
 * (we assume /delivery/items?asc=false already returns newest first).
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

  return { activeItems, expiredItems };
}

// -------------------------------------------------------------------
// INVENTORY EMBED FIELD BUILDERS
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// INVENTORY EMBED FIELD BUILDERS
// -------------------------------------------------------------------

/**
 * Discord embed fields cannot exceed 1024 chars in value.
 * This helper splits big lists into multiple safe-sized fields.
 */
function splitIntoEmbedFields(title, lines) {
  const fields = [];
  if (!Array.isArray(lines) || lines.length === 0) {
    return fields;
  }

  let current = [];
  let currentLength = 0;
  let index = 1;

  for (const line of lines) {
    const lineLength = line.length + 1; // newline

    // If adding this line would exceed 1024 chars,
    // push the chunk and start a new one
    if (currentLength + lineLength > 1024) {
      fields.push({
        name: index === 1 ? title : `${title} (${index})`,
        value: current.join("\n"),
        inline: false,
      });
      index++;
      current = [];
      currentLength = 0;
    }

    current.push(line);
    currentLength += lineLength;
  }

  // Push the final chunk
  if (current.length > 0) {
    fields.push({
      name: index === 1 ? title : `${title} (${index})`,
      value: current.join("\n"),
      inline: false,
    });
  }

  return fields;
}


/**
 * Build the inventory "line" for an active product:
 *   • Product | Server [Runtime]
 */
function formatActiveLine(item) {
  const slug = getProductSlugFromItem(item);
  const parsed = parseProductSlug(slug);

  const base = `${parsed.productName} | ${parsed.serverName}`;

  // Credits, tags, namecolor => no runtime bracket
  if (
    parsed.kind === "credits" ||
    parsed.kind === "tag" ||
    parsed.kind === "namecolor"
  ) {
    return `• ${base}`;
  }

  if (parsed.runtimeText) {
    return `• ${base} [${parsed.runtimeText}]`;
  }

  // Generic without runtime
  return `• ${base}`;
}

/**
 * Build the inventory "line" for an expired product:
 *   • Product | Server [Runtime] — Expired 5 days ago
 */
function formatExpiredLine(item) {
  const slug = getProductSlugFromItem(item);
  const parsed = parseProductSlug(slug);

  const base = `${parsed.productName} | ${parsed.serverName}`;

  // Credits, tags, namecolor => no runtime bracket
  let line;
  if (
    parsed.kind === "credits" ||
    parsed.kind === "tag" ||
    parsed.kind === "namecolor"
  ) {
    line = `• ${base}`;
  } else if (parsed.runtimeText) {
    line = `• ${base} [${parsed.runtimeText}]`;
  } else {
    line = `• ${base}`;
  }

  const expiryLabel = formatExpiryLabel(item, true); // e.g. "expired 5 days ago"
  const capitalizedExpiry =
    expiryLabel && expiryLabel.length > 0
      ? expiryLabel.charAt(0).toUpperCase() + expiryLabel.slice(1)
      : "Expired";

  return `${line} — ${capitalizedExpiry}`;
}

function shouldExcludeFromExpired(item) {
  const slug = getProductSlugFromItem(item);
  const parsed = parseProductSlug(slug);

  // Exclude credits, tags, namecolor
  if (parsed.kind === "credits") return true;
  if (parsed.kind === "tag") return true;
  if (parsed.kind === "namecolor") return true;

  // Exclude Permanent runtime
  if (parsed.runtimeText && parsed.runtimeText.toLowerCase() === "permanent") {
    return true;
  }

  return false;
}

/**
 * Build embed fields for the INVENTORY section:
 *
 * ===== INVENTORY =====
 * Active Products
 * • ...
 * Recently Expired
 * • ...
 */
function buildInventoryFieldsFromItems(activeItems, expiredItems, customerId) {
  const fields = [];

  // ACTIVE
  if (Array.isArray(activeItems) && activeItems.length > 0) {
    const activeLines = activeItems.map((item) => formatActiveLine(item));
    fields.push(
      ...splitIntoEmbedFields("Active Products", activeLines)
    );
  }

  // FILTER & LIMIT EXPIRED
  let expiredToShow = Array.isArray(expiredItems)
    ? expiredItems.filter(item => !shouldExcludeFromExpired(item))
    : [];

  if (expiredToShow.length > MAX_EXPIRED_ITEMS) {
    expiredToShow = expiredToShow.slice(0, MAX_EXPIRED_ITEMS);
  }

  // EXPIRED
  if (expiredToShow.length > 0) {
    const expiredLines = expiredToShow.map((item) => formatExpiredLine(item));
    fields.push(
      ...splitIntoEmbedFields("Recently Expired", expiredLines)
    );
  }

  // No inventory at all
  if (fields.length === 0) {
    fields.push({
      name: "Inventory",
      value: "No products found for this customer.",
      inline: false,
    });
  }

  // Add clickable PayNow link
    if (customerId) {
    fields.push({
        name: "PayNow",
        value: `[Customer Page](https://dashboard.paynow.gg/customers/${customerId})`,
        inline: false,
    });
    }

  return fields;
}


// -------------------------------------------------------------------
// PAYNOW HTTP CALLS
// -------------------------------------------------------------------

/**
 * Lookup a PayNow customer by SteamID64.
 *
 * GET /v1/stores/{storeId}/customers/lookup?steam_id=<steam64>
 */
async function lookupCustomerBySteamId(steamId) {
  if (!PAYNOW_API_KEY || !PAYNOW_STORE_ID || !steamId) return null;

  try {
    const url = `${PAYNOW_BASE_URL}/v1/stores/${PAYNOW_STORE_ID}/customers/lookup`;

    const resp = await axios.get(url, {
      params: { steam_id: steamId },
      headers: {
        Authorization: `APIKey ${PAYNOW_API_KEY}`,
        Accept: "*/*",
      },
    });

    const customer = resp.data;
    if (!customer || !customer.id) return null;
    return customer;
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
 */
async function getCustomerDeliveryItems(customerId) {
  if (!PAYNOW_API_KEY || !PAYNOW_STORE_ID || !customerId) return [];

  try {
    const url = `${PAYNOW_BASE_URL}/v1/stores/${PAYNOW_STORE_ID}/customers/${customerId}/delivery/items`;

    const resp = await axios.get(url, {
      params: {
        limit: 100,
        asc: false, // newest first
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
 * High-level helper used by ticketCreate:
 *  1) Lookup customer by SteamID
 *  2) Fetch delivery items
 *  3) Split into active/expired
 */
async function fetchCustomerInventoryForSteam(steamId) {
  if (!steamId) return null;

  const customer = await lookupCustomerBySteamId(steamId);
  if (!customer || !customer.id) return null;

  const items = await getCustomerDeliveryItems(customer.id);
  const { activeItems, expiredItems } = splitActiveAndExpired(items);

  return {
    activeItems,
    expiredItems,
    customerId: customer.id
  };
}


module.exports = {
  fetchCustomerInventoryForSteam,
  buildInventoryFieldsFromItems,
};
