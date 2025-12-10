const { EmbedBuilder } = require("discord.js");
const { extractSteamIdsFromText, formatDaysAgo } = require("./steamUtils.js");

/**
 * Extract Steam IDs from answers
 */
function collectSteamIdsFromAnswers(modalAnswers) {
  if (!Array.isArray(modalAnswers)) return [];
  const allText = modalAnswers
    .map((q) => (typeof q.value === "string" ? q.value : ""))
    .join("\n");

  return extractSteamIdsFromText(allText);
}

/**
 * Resolve Reporter vs Targets
 */
function splitReporterAndTargets(allIds, isReportChannel) {
  if (!allIds || allIds.length === 0) {
    return { reporterId: null, targetIds: [] };
  }
  const unique = [...new Set(allIds)];
  const reporterId = unique[0];

  if (!isReportChannel) {
    return { reporterId, targetIds: [] };
  }

  const targetIds = unique.slice(1);
  return { reporterId, targetIds };
}

/**
 * PvP Stats: "K | D | K/D"
 */
function buildPvpLine(profile) {
  const pvp = profile?.enardoStats?.pvp;

  if (!pvp) {
    return `PvP: No PvP data logged`;
  }

  const kills = pvp?.kills ?? 0;
  const deaths = pvp?.deaths ?? 0;

  let kdr = "N/A";
  if (kills > 0 && deaths > 0) {
    kdr = (kills / deaths).toFixed(2);
  } else if (kills > 0 && deaths === 0) {
    kdr = kills.toFixed(2);
  }

  return `Stats: K: ${kills} | D: ${deaths} | K/D: ${kdr}`;
}

/**
 * Visual Separator Headers
 */
function buildSeparator(title) {
  return {
    name: `===== ${title.toUpperCase()} =====`,
    value: "\u200B",
    inline: false,
  };
}

/**
 * Ban line with time since ban
 */
function buildBanLine(profile) {
  const vac = profile?.vacBans ?? 0;
  const game = profile?.gameBans ?? 0;
  const days = profile?.daysSinceLastBan ?? null;

  if (vac === 0 && game === 0) {
    return `Bans: VAC: ${vac}, Game: ${game}`;
  }

  const base = `Bans: VAC: ${vac}, Game: ${game}`;
  const since = formatDaysAgo(days);
  return since ? `${base} (last ban ${since})` : base;
}

/**
 * Reporter block (shown under ===== REPORTER or ===== INFORMATION)
 */
function buildReporterField(profile) {
  if (!profile) return null;

  const { formatServerTime } = require("./steamUtils.js");
  const serverTime = profile?.enardoStats?.misc?.time_played;

  let rustPlaytime;
  if (profile.rustHours === 0 && serverTime > 0) {
    rustPlaytime = "Private / Not Visible";
  } else {
    rustPlaytime =
      profile.rustHours != null ? `${profile.rustHours} hrs` : "N/A";
  }

  let value = "";
  value += `Steam: ${profile.steamName}\n`;
  value += `SteamID64: \`${profile.steamId}\`\n`;
  value += `Rust Playtime: ${rustPlaytime}\n`;

  if (serverTime && serverTime > 0) {
    value += `Server Playtime: ${formatServerTime(serverTime)}\n`;
  }

  value += `${buildPvpLine(profile)}\n`;
  value += `${buildBanLine(profile)}\n`;
  value += `Links: [Steam Profile](${profile.steamProfileUrl}) | [BattleMetrics](${profile.battlemetricsUrl})`;

  return { name: "\u200B", value, inline: false };
}

/**
 * Target blocks under ===== TARGETS =====
 */
function buildTargetFields(targetProfiles) {
  if (!Array.isArray(targetProfiles) || targetProfiles.length === 0) return [];

  const { formatServerTime } = require("./steamUtils.js");
  const fields = [];

  targetProfiles.forEach((profile, idx) => {
    if (!profile) return;

    const serverTime = profile?.enardoStats?.misc?.time_played;
    let rustPlaytime;
    if (profile.rustHours === 0 && serverTime > 0) {
      rustPlaytime = "Private / Not Visible";
    } else {
      rustPlaytime =
        profile.rustHours != null ? `${profile.rustHours} hrs` : "N/A";
    }

    let value = "";
    value += `Target ${idx + 1}\n`;
    value += `Steam: ${profile.steamName}\n`;
    value += `SteamID64: \`${profile.steamId}\`\n`;
    value += `Rust Playtime: ${rustPlaytime}\n`;

    if (serverTime && serverTime > 0) {
      value += `Server Playtime: ${formatServerTime(serverTime)}\n`;
    }

    value += `${buildPvpLine(profile)}\n`;
    value += `${buildBanLine(profile)}\n`;
    value += `Links: [Steam Profile](${profile.steamProfileUrl}) | [BattleMetrics](${profile.battlemetricsUrl})`;

    fields.push({ name: "\u200B", value, inline: false });
  });

  return fields;
}

/**
 * Admin overview embed (unchanged layout)
 */
function buildAdminSteamEmbed(
  interaction,
  channel,
  reporterProfile,
  targetsProfiles,
) {
  if (!reporterProfile && (!targetsProfiles || targetsProfiles.length === 0)) {
    return null;
  }

  const embed = new EmbedBuilder()
    .setColor("#0099ff")
    .setTitle("Ticket Steam Overview")
    .setDescription(
      `Ticket: #${channel.name} (${channel.id})\nCreated by: ${interaction.user.tag} (${interaction.user.id})`,
    )
    .setTimestamp()
    .setFooter({
      text: interaction.user.tag,
      iconURL: interaction.user.displayAvatarURL({ extension: "png" }),
    });

  const reporterField = buildReporterField(reporterProfile);
  if (reporterField) embed.addFields(reporterField);

  const targetFields = buildTargetFields(targetsProfiles || []);
  if (targetFields.length > 0) embed.addFields(targetFields);

  return embed;
}

module.exports = {
  collectSteamIdsFromAnswers,
  splitReporterAndTargets,
  buildReporterField,
  buildTargetFields,
  buildAdminSteamEmbed,
  buildSeparator,
};
