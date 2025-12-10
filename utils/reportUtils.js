const { EmbedBuilder } = require("discord.js");
const { extractSteamIdsFromText, formatDaysAgo } = require("./steamUtils.js");

/**
 * Build list of Steam ID candidates from modal answers.
 * modalAnswers: [{ label, value }]
 */
function collectSteamIdsFromAnswers(modalAnswers) {
  if (!Array.isArray(modalAnswers)) return [];
  const allText = modalAnswers
    .map((q) => (typeof q.value === "string" ? q.value : ""))
    .join("\n");

  const ids = extractSteamIdsFromText(allText);
  return ids;
}

/**
 * Decide reporter vs targets based on collected IDs and ticket type.
 * - For report channels: first = reporter, rest = targets
 * - For other channels: first = "steam for this ticket", no targets
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
 * Format PvP line according to your spec:
 * - If no data: "PvP Stats: No PvP data logged"
 * - Else: "PvP Stats: K: <kills> | D: <deaths> | K/D: <ratio>"
 */
function buildPvpLine(profile) {
  const pvp = profile?.enardoStats?.pvp;
  if (!pvp) {
    return "PvP Stats: No PvP data logged";
  }

  const kills = pvp.kills ?? 0;
  const deaths = pvp.deaths ?? 0;

  if (!kills && !deaths) {
    return "PvP Stats: No PvP data logged";
  }

  let kd;
  if (typeof pvp.kd === "number") {
    kd = pvp.kd;
  } else if (deaths > 0) {
    kd = kills / deaths;
  } else {
    // deaths = 0 but kills > 0 - treat KD as kills
    kd = kills;
  }

  const kdStr = kd != null ? kd.toFixed(2) : "N/A";
  return `PvP Stats: K: ${kills} | D: ${deaths} | K/D: ${kdStr}`;
}

/**
 * Build ban info line.
 * If any bans, also append time since last ban if known.
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
  if (since) {
    return `${base} (last ban ${since})`;
  }
  return base;
}

/**
 * Build a single field for the reporter.
 * isReportChannel controls the header text.
 */
function buildReporterField(profile, isReportChannel) {
  if (!profile) return null;

  const header = isReportChannel ? "Reporter Steam Info" : "Steam Information";

  const rustHours =
    profile.rustHours != null ? `${profile.rustHours} hrs` : "N/A";
  const pvpLine = buildPvpLine(profile);
  const banLine = buildBanLine(profile);

  let value = "";
  value += `Steam: ${profile.steamName}\n`;
  value += `SteamID64: \`${profile.steamId}\`\n`;
  value += `Rust Hours: ${rustHours}\n`;
  value += `${pvpLine}\n`;
  value += `${banLine}\n`;
  value += `Links: [Steam Profile](${profile.steamProfileUrl}) | [BattleMetrics](${profile.battlemetricsUrl})`;

  return {
    name: header,
    value,
    inline: false,
  };
}

/**
 * Build fields for all targets.
 */
function buildTargetFields(targetProfiles) {
  if (!Array.isArray(targetProfiles) || targetProfiles.length === 0) {
    return [];
  }

  const fields = [];

  targetProfiles.forEach((profile, idx) => {
    if (!profile) return;
    const header = `Target #${idx + 1} Steam Info`;

    const rustHours =
      profile.rustHours != null ? `${profile.rustHours} hrs` : "N/A";
    const pvpLine = buildPvpLine(profile);
    const banLine = buildBanLine(profile);

    let value = "";
    value += `Steam: ${profile.steamName}\n`;
    value += `SteamID64: \`${profile.steamId}\`\n`;
    value += `Rust Hours: ${rustHours}\n`;
    value += `${pvpLine}\n`;
    value += `${banLine}\n`;
    value += `Links: [Steam Profile](${profile.steamProfileUrl}) | [BattleMetrics](${profile.battlemetricsUrl})`;

    fields.push({
      name: header,
      value,
      inline: false,
    });
  });

  return fields;
}

/**
 * Admin-only embed with the same info.
 */
function buildAdminSteamEmbed(
  interaction,
  channel,
  reporterProfile,
  targetsProfiles,
  isReportChannel,
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

  const reporterField = buildReporterField(reporterProfile, isReportChannel);
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
};
