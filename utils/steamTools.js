const axios = require("axios");
const STEAM_API_KEY = process.env.STEAM_API_KEY;

// Regexes from your old system
const steamIdRegex = {
  steam64: /^7656119\d{10}$/,
  steam32: /^STEAM_0:[01]:\d+$/,
  vanityUrl: /^[A-Za-z0-9_-]{2,32}$/,
};

function convertSteam32To64(steam32) {
  const parts = steam32.split(":");
  const Y = parseInt(parts[1], 10);
  const Z = parseInt(parts[2], 10);
  return String(Z * 2 + 76561197960265728 + Y);
}

function extractSteamId(input) {
  input = input.trim();

  // Steam64 URL
  if (input.includes("steamcommunity.com/profiles/")) {
    const id = input.split("/profiles/")[1].replace("/", "");
    return steamIdRegex.steam64.test(id) ? id : null;
  }

  // Vanity URL
  if (input.includes("steamcommunity.com/id/")) {
    return input.split("/id/")[1].replace("/", "");
  }

  // Raw 64
  if (steamIdRegex.steam64.test(input)) return input;

  // STEAM_0:X:Y format
  if (steamIdRegex.steam32.test(input)) {
    return convertSteam32To64(input);
  }

  // Vanity input
  if (steamIdRegex.vanityUrl.test(input)) return input;

  return null;
}

async function resolveVanity(vanity) {
  const url = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${STEAM_API_KEY}&vanityurl=${vanity}`;
  const { data } = await axios.get(url);
  if (data?.response?.success === 1) {
    return data.response.steamid;
  }
  return null;
}

async function getSteamSummary(steam64) {
  const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steam64}`;
  const { data } = await axios.get(url);
  return data?.response?.players?.[0] || null;
}

async function getSteamBans(steam64) {
  const url = `https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/?key=${STEAM_API_KEY}&steamids=${steam64}`;
  const { data } = await axios.get(url);
  return data?.players?.[0] || null;
}

async function getRustHours(steam64) {
  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${STEAM_API_KEY}&steamid=${steam64}&include_played_free_games=1`;
  const { data } = await axios.get(url);
  const games = data?.response?.games || [];
  const rust = games.find(g => g.appid === 252490);
  return rust ? Math.round(rust.playtime_forever / 60) : 0;
}

async function processSteam(interaction, ticketOpenEmbed) {
  const answer = interaction.fields?.getTextInputValue("question1");  
  if (!answer) return null;

  let steamId = extractSteamId(answer);

  if (!steamId) return { error: true, reason: "Invalid Steam ID" };

  if (!steamId.startsWith("7656119")) {
    steamId = await resolveVanity(steamId);
    if (!steamId) return { error: true, reason: "Could not resolve vanity URL" };
  }

  const steamSummary = await getSteamSummary(steamId);
  const steamBans = await getSteamBans(steamId);
  const rustHours = await getRustHours(steamId);

  return {
    steam64: steamId,
    username: steamSummary?.personaname || "Unknown",
    avatar: steamSummary?.avatarfull || null,
    profileUrl: `https://steamcommunity.com/profiles/${steamId}`,
    vacBans: steamBans?.NumberOfVACBans || 0,
    gameBans: steamBans?.NumberOfGameBans || 0,
    rustHours,
  };
}

module.exports = {
  processSteam,
};
