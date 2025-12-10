const axios = require("axios");

const STEAM_API_KEY = process.env.STEAM_API_KEY;
const ENARDO_API_BASE = process.env.ENARDO_API_BASE || "https://enardo.gg";

// Regexes for extracting IDs from free text
const STEAM64_REGEX = /7656119\d{10}/g;
const STEAM32_REGEX = /STEAM_0:[01]:\d+/g;
const STEAM_PROFILES_URL_REGEX =
  /https?:\/\/steamcommunity\.com\/profiles\/(\d+)/gi;
const STEAM_ID_URL_REGEX =
  /https?:\/\/steamcommunity\.com\/id\/([A-Za-z0-9_\-]+)/gi;

/**
 * Convert STEAM_0:X:Y → Steam64 as string
 */
function steam32ToSteam64(steam32) {
  const parts = steam32.split(":");
  const Y = parseInt(parts[1], 10);
  const Z = parseInt(parts[2], 10);
  const base = BigInt("76561197960265728");
  const id = base + BigInt(Z * 2 + Y);
  return id.toString();
}

/**
 * Extract potential Steam identifiers from free text.
 * Returns an array of candidates (some are already 64-bit, some vanity).
 */
function extractSteamIdsFromText(text) {
  if (!text || typeof text !== "string") return [];
  const results = new Set();

  // Raw 64 IDs
  const s64Matches = text.match(STEAM64_REGEX);
  if (s64Matches) s64Matches.forEach((id) => results.add(id));

  // STEAM_0:X:Y
  const s32Matches = text.match(STEAM32_REGEX);
  if (s32Matches) {
    s32Matches.forEach((steam32) => {
      results.add(steam32ToSteam64(steam32));
    });
  }

  // /profiles/<id>
  let m;
  while ((m = STEAM_PROFILES_URL_REGEX.exec(text)) !== null) {
    if (m[1]) results.add(m[1]);
  }

  // /id/<vanity>
  while ((m = STEAM_ID_URL_REGEX.exec(text)) !== null) {
    if (m[1]) results.add(m[1]);
  }

  return Array.from(results);
}

/**
 * Resolve vanity or numeric to Steam64.
 * - If already a Steam64, returns it directly.
 * - Otherwise tries ResolveVanityURL.
 */
async function normalizeToSteam64(idOrVanity) {
  if (!idOrVanity) return null;

  // Already looks like steam64
  if (/^7656119\d{10}$/.test(idOrVanity)) return idOrVanity;

  if (!STEAM_API_KEY) return null;

  try {
    const resp = await axios.get(
      "https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/",
      {
        params: {
          key: STEAM_API_KEY,
          vanityurl: idOrVanity,
        },
      },
    );
    if (resp.data?.response?.success === 1) {
      return resp.data.response.steamid;
    }
    return null;
  } catch (err) {
    console.error("[Steam] normalizeToSteam64 error:", err.message || err);
    return null;
  }
}

/**
 * Get Steam player summary
 */
async function fetchSteamSummary(steam64) {
  if (!STEAM_API_KEY || !steam64) return null;
  try {
    const resp = await axios.get(
      "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/",
      {
        params: {
          key: STEAM_API_KEY,
          steamids: steam64,
        },
      },
    );
    return resp.data?.response?.players?.[0] || null;
  } catch (err) {
    console.error("[Steam] fetchSteamSummary error:", err.message || err);
    return null;
  }
}

/**
 * Get Steam bans
 * Returns object with:
 * - NumberOfVACBans
 * - NumberOfGameBans
 * - DaysSinceLastBan
 * - CommunityBanned
 * - EconomyBan
 */
async function fetchSteamBans(steam64) {
  if (!STEAM_API_KEY || !steam64) return null;
  try {
    const resp = await axios.get(
      "https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/",
      {
        params: {
          key: STEAM_API_KEY,
          steamids: steam64,
        },
      },
    );
    return resp.data?.players?.[0] || null;
  } catch (err) {
    console.error("[Steam] fetchSteamBans error:", err.message || err);
    return null;
  }
}

/**
 * Get Rust hours via owned games
 */
async function fetchRustHours(steam64) {
  if (!STEAM_API_KEY || !steam64) return null;
  try {
    const resp = await axios.get(
      "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/",
      {
        params: {
          key: STEAM_API_KEY,
          steamid: steam64,
          include_appinfo: false,
          include_played_free_games: 1,
        },
      },
    );
    const games = resp.data?.response?.games || [];
    const rust = games.find((g) => g.appid === 252490);
    if (!rust) return 0;
    return Math.round((rust.playtime_forever || 0) / 60);
  } catch (err) {
    console.error("[Steam] fetchRustHours error:", err.message || err);
    return null;
  }
}

/**
 * Fetch Enardo stats from /api/discordstats?steamId=
 */
async function fetchEnardoStats(steam64) {
  if (!steam64) return null;

  const base = ENARDO_API_BASE.replace(/\/+$/, "");
  const url = `${base}/api/discordstats`;

  try {
    const resp = await axios.get(url, {
      params: { steamId: steam64 },
    });
    if (!resp.data || resp.data.error) return null;
    return resp.data;
  } catch (err) {
    console.error("[Enardo] fetchEnardoStats error:", err.message || err);
    return null;
  }
}

/**
 * Convenience: combine Steam + Enardo into a single profile object.
 */
async function getFullPlayerProfile(rawId) {
  if (!rawId) return null;

  const steam64 = await normalizeToSteam64(rawId);
  if (!steam64) return null;

  const [summary, bans, rustHours, enardo] = await Promise.all([
    fetchSteamSummary(steam64),
    fetchSteamBans(steam64),
    fetchRustHours(steam64),
    fetchEnardoStats(steam64),
  ]);

  const vacBans = bans?.NumberOfVACBans ?? 0;
  const gameBans = bans?.NumberOfGameBans ?? 0;
  const daysSinceLastBan = bans?.DaysSinceLastBan ?? null;

  return {
    steamId: steam64,
    steamName: summary?.personaname || enardo?.username || "Unknown",
    steamAvatar:
      summary?.avatarfull || summary?.avatar || enardo?.avatar || null,
    steamProfileUrl: `https://steamcommunity.com/profiles/${steam64}`,
    battlemetricsUrl: `https://www.battlemetrics.com/rcon/players?filter[search]=${steam64}`,
    rustHours: rustHours ?? null,
    vacBans,
    gameBans,
    daysSinceLastBan,
    communityBanned: bans?.CommunityBanned ?? null,
    economyBan: bans?.EconomyBan ?? null,
    enardoStats: {
      pvp: enardo?.stats?.pvp || null,
      resources: enardo?.stats?.resources || null,
      explosives: enardo?.stats?.explosives || null,
      farming: enardo?.stats?.farming || null,
      misc: enardo?.stats?.misc || null,
      events: enardo?.stats?.events || null,
    },
  };
}

/**
 * Format a "X days ago" string for ban timing.
 */
function formatDaysAgo(days) {
  if (!days || days <= 0) return null;
  if (days < 30) {
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    return `${months} month${months === 1 ? "" : "s"} ago`;
  }
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

function formatServerTime(seconds) {
  const total = Number(seconds);
  if (!total || isNaN(total) || total <= 0) return "0m";

  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);

  let result = "";
  if (days > 0) result += `${days}d `;
  if (hours > 0) result += `${hours}h `;
  if (minutes > 0) result += `${minutes}m`;
  return result.trim() || "0m";
}


module.exports = {
  ...module.exports,
  formatServerTime,
};


module.exports = {
  extractSteamIdsFromText,
  getFullPlayerProfile,
  formatDaysAgo,
  formatServerTime,
};
