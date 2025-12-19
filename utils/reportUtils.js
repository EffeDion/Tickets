const { EmbedBuilder } = require("discord.js");
const {
  extractSteamIdsFromText,
  formatDaysAgo,
  formatServerTime,
} = require("./steamUtils.js");

/**
 * Extract Steam IDs from specific questions based on their labels
 * Returns { reporterIds: [], suspectIds: [] }
 */
function collectSteamIdsFromAnswers(modalAnswers) {
  if (!Array.isArray(modalAnswers)) return { reporterIds: [], suspectIds: [] };

  const reporterIds = [];
  const suspectIds = [];

  modalAnswers.forEach((q) => {
    if (!q.value || typeof q.value !== "string") return;

    const labelLower = (q.label || "").toLowerCase();
    const idsInAnswer = extractSteamIdsFromText(q.value);

    // Question explicitly asks for user's Steam ID
    if (
      labelLower.includes("your steam") ||
      labelLower.includes("steamid64") ||
      labelLower === "steam id" ||
      labelLower === "steamid"
    ) {
      reporterIds.push(...idsInAnswer);
    }
    // Question asks about reporting someone or suspects
    else if (
      labelLower.includes("report") ||
      labelLower.includes("suspect") ||
      labelLower.includes("player") ||
      labelLower.includes("cheater") ||
      labelLower.includes("offender")
    ) {
      suspectIds.push(...idsInAnswer);
    }
    // Fallback: if we don't have clear context, add to suspects
    else if (idsInAnswer.length > 0) {
      suspectIds.push(...idsInAnswer);
    }
  });

  return {
    reporterIds: [...new Set(reporterIds)],
    suspectIds: [...new Set(suspectIds)],
  };
}

/**
 * Resolve Reporter vs Suspects with improved logic
 */
function splitReporterAndTargets(modalAnswers, isReportChannel) {
  const { reporterIds, suspectIds } = collectSteamIdsFromAnswers(modalAnswers);

  // If not a report channel, first ID found is the reporter
  if (!isReportChannel) {
    const allIds = [...reporterIds, ...suspectIds];
    return {
      reporterId: allIds[0] || null,
      targetIds: [],
    };
  }

  // For report channels
  let reporterId = null;
  let targetIds = [];

  // Priority 1: Use explicitly identified reporter
  if (reporterIds.length > 0) {
    reporterId = reporterIds[0];
    // All other IDs (including other reporterIds) become suspects
    targetIds = [...reporterIds.slice(1), ...suspectIds];
  }
  // Priority 2: If no explicit reporter but we have suspects
  else if (suspectIds.length > 0) {
    // First suspect becomes reporter, rest are suspects
    reporterId = suspectIds[0];
    targetIds = suspectIds.slice(1);
  }

  return {
    reporterId,
    targetIds: [...new Set(targetIds)], // Remove duplicates
  };
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
 * Reporter / Player / Information block with merged header
 */
function buildReporterField(profile, isReportChannel = true) {
  if (!profile) return [];

  const sectionTitle = isReportChannel ? "👤 PLAYER" : "👤 INFORMATION";
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

  // Return as single merged field
  return [
    {
      name: `━━━━━ ${sectionTitle} ━━━━━`,
      value,
      inline: false,
    },
  ];
}

/**
 * Target/Suspect blocks with merged header
 */
function buildTargetFields(targetProfiles) {
  if (!Array.isArray(targetProfiles) || targetProfiles.length === 0) return [];

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

    const suspectLabel = targetProfiles.length === 1 ? "❗ SUSPECT" : `❗ SUSPECT ${idx + 1}`;

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

    // Return as single merged field per suspect
    fields.push({
      name: `━━━━━ ${suspectLabel} ━━━━━`,
      value,
      inline: false,
    });
  });

  return fields;
}

/**
 * Admin overview embed
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

  const isReportChannel = targetsProfiles && targetsProfiles.length > 0;

  const reporterFields = buildReporterField(
    reporterProfile,
    isReportChannel,
  );
  if (reporterFields.length > 0) {
    embed.addFields(reporterFields);
  }

  const targetFields = buildTargetFields(targetsProfiles || []);
  if (targetFields.length > 0) {
    embed.addFields(targetFields);
  }

  return embed;
}

module.exports = {
  collectSteamIdsFromAnswers,
  splitReporterAndTargets,
  buildReporterField,
  buildTargetFields,
  buildAdminSteamEmbed,
};