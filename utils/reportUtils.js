const { EmbedBuilder } = require("discord.js");
const { extractSteamIdsFromText } = require("./steamUtils.js");

/**
 * Given an array of modal answers, extract all Steam IDs/URLs.
 * modalAnswers: [{ label, value }]
 */
function collectSteamIdsFromAnswers(modalAnswers) {
  const allText = modalAnswers
    .map((q) => (typeof q.value === "string" ? q.value : ""))
    .join("\n");

  const ids = extractSteamIdsFromText(allText);
  return ids;
}

/**
 * Split between reporter and targets.
 * - For report channels: first = reporter, rest = targets
 * - Non-report channels: first = reporter, no targets
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
 * Build embed fields for ticket embed.
 * Note: neutral, no “suspicious” flags.
 */
function buildSteamSummaryFields(
  reporterProfile,
  targetsProfiles,
  isReportChannel,
) {
  const fields = [];

  if (reporterProfile) {
    const pvp = reporterProfile.enardoStats.pvp;
    const kd =
      pvp?.kd ??
      (pvp?.deaths
        ? (pvp.kills || 0) / (pvp.deaths || 1)
        : pvp?.kills || null);
    const kdStr = kd != null ? kd.toFixed(2) : "N/A";

    const rustHours =
      reporterProfile.rustHours != null
        ? `${reporterProfile.rustHours} hrs`
        : "N/A";

    const vac = reporterProfile.vacBans ?? "N/A";
    const gameBans = reporterProfile.gameBans ?? "N/A";

    let value = `Steam: [${reporterProfile.steamName}](${reporterProfile.steamProfileUrl})\n`;
    value += `SteamID64: \`${reporterProfile.steamId}\`\n`;
    value += `Rust Hours: **${rustHours}**\n`;
    value += `KD: **${kdStr}**`;

    if (vac !== "N/A" || gameBans !== "N/A") {
      value += `\nVAC Bans: **${vac}**, Game Bans: **${gameBans}**`;
    }

    fields.push({
      name: "Reporter Steam Info",
      value,
      inline: false,
    });
  }

  if (isReportChannel && targetsProfiles && targetsProfiles.length > 0) {
    targetsProfiles.forEach((target, idx) => {
      const pvp = target.enardoStats.pvp;
      const kd =
        pvp?.kd ??
        (pvp?.deaths
          ? (pvp.kills || 0) / (pvp.deaths || 1)
          : pvp?.kills || null);
      const kdStr = kd != null ? kd.toFixed(2) : "N/A";

      const rustHours =
        target.rustHours != null ? `${target.rustHours} hrs` : "N/A";

      const vac = target.vacBans ?? "N/A";
      const gameBans = target.gameBans ?? "N/A";

      let value = `Steam: [${target.steamName}](${target.steamProfileUrl})\n`;
      value += `SteamID64: \`${target.steamId}\`\n`;
      value += `Rust Hours: **${rustHours}**\n`;
      value += `KD: **${kdStr}**`;

      if (vac !== "N/A" || gameBans !== "N/A") {
        value += `\nVAC Bans: **${vac}**, Game Bans: **${gameBans}**`;
      }

      fields.push({
        name: `Target #${idx + 1} Steam Info`,
        value,
        inline: false,
      });
    });
  }

  return fields;
}

/**
 * Build admin-only embed for logs.
 * Uses reporter + targets information.
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
      `Ticket: ${channel} (${channel.id})\nCreated by: ${interaction.user.tag} (${interaction.user.id})`,
    )
    .setTimestamp()
    .setFooter({
      text: interaction.user.tag,
      iconURL: interaction.user.displayAvatarURL({ extension: "png" }),
    });

  const reporterFields = buildSteamSummaryFields(
    reporterProfile,
    [],
    false,
  );
  reporterFields.forEach((f) => embed.addFields(f));

  if (isReportChannel && targetsProfiles && targetsProfiles.length > 0) {
    const targetsFields = buildSteamSummaryFields(
      null,
      targetsProfiles,
      true,
    );
    targetsFields.forEach((f) => embed.addFields(f));
  }

  return embed;
}

module.exports = {
  collectSteamIdsFromAnswers,
  splitReporterAndTargets,
  buildSteamSummaryFields,
  buildAdminSteamEmbed,
};
