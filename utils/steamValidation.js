const { EmbedBuilder } = require("discord.js");
const { extractSteamIdsFromText } = require("./steamUtils.js");
const { collectSteamIdsFromAnswers } = require("./reportUtils.js");

/**
 * Validates Steam ID requirements based on ticket type
 * Returns validation result with error message if needed
 */
function validateSteamIds(channelName, modalAnswers) {
  const channelNameLower = channelName.toLowerCase();
  const isReportChannel = channelNameLower.includes("report");
  const isAppealChannel = channelNameLower.includes("appeal") || channelNameLower.includes("ban");
  const isPaymentChannel = channelNameLower.includes("payment");
  const skipValidation = channelNameLower.includes("discord");

  // Skip validation for discord-related tickets
  if (skipValidation) {
    return { valid: true };
  }

  // Collect all Steam IDs from answers
  const allIds = [];
  if (Array.isArray(modalAnswers)) {
    const allText = modalAnswers
      .map((q) => (typeof q.value === "string" ? q.value : ""))
      .join("\n");
    allIds.push(...extractSteamIdsFromText(allText));
  }

  const uniqueIds = [...new Set(allIds)];

  // Validation for REPORT tickets
  if (isReportChannel) {
    const { reporterIds, suspectIds } = collectSteamIdsFromAnswers(modalAnswers);

    if (uniqueIds.length === 0) {
      return {
        valid: false,
        type: "report",
        missing: "both",
        message: buildMissingInfoEmbed("report", "both"),
      };
    }
    if (reporterIds.length === 0 && suspectIds.length > 0) {
      return {
        valid: false,
        type: "report",
        missing: "reporter",
        message: buildMissingInfoEmbed("report", "reporter"),
      };
    }
    if (suspectIds.length === 0 && reporterIds.length > 0) {
      return {
        valid: false,
        type: "report",
        missing: "suspect",
        message: buildMissingInfoEmbed("report", "suspect"),
      };
    }
    return { valid: true };
  }

  // Validation for APPEAL/BAN tickets
  if (isAppealChannel) {
    if (uniqueIds.length === 0) {
      return {
        valid: false,
        type: "appeal",
        missing: "player",
        message: buildMissingInfoEmbed("appeal", "player"),
      };
    }
    // Valid: has at least player's Steam ID
    return { valid: true };
  }

  // Validation for PAYMENT tickets
  if (isPaymentChannel) {
    if (uniqueIds.length === 0) {
      return {
        valid: false,
        type: "payment",
        missing: "player",
        message: buildMissingInfoEmbed("payment", "player"),
      };
    }
    // Valid: has at least player's Steam ID
    return { valid: true };
  }

  // For other ticket types, if they're not discord-related, they should have at least one ID
  if (uniqueIds.length === 0) {
    return {
      valid: false,
      type: "general",
      missing: "player",
      message: buildMissingInfoEmbed("general", "player"),
    };
  }

  return { valid: true };
}

/**
 * Build an embed for missing Steam ID information
 */
function buildMissingInfoEmbed(ticketType, missingType) {
  const embed = new EmbedBuilder()
    .setColor("#FF6B6B")
    .setTitle("⚠️ Missing Required Information")
    .setTimestamp();

  let description = "";
  let fields = [];

  switch (ticketType) {
    case "report":
      if (missingType === "reporter") {
        description = "Your report ticket is missing your own Steam ID.";
        fields = [
          {
            name: "📋 Required Information",
            value: "**Your own Steam ID** (the player creating this report)",
            inline: false,
          },
          {
            name: "💡 How to Provide",
            value: "Please send a message with your Steam ID in any of these formats:\n" +
                  "• Steam64 ID: `76561198XXXXXXXXX`\n" +
                  "• Steam Profile URL: `https://steamcommunity.com/profiles/76561198XXXXXXXXX`\n" +
                  "• Steam Vanity URL: `https://steamcommunity.com/id/yourname`\n" +
                  "• STEAM_0 format: `STEAM_0:1:12345678`",
            inline: false,
          },
        ];
      } else if (missingType === "both") {
        description = "Your report ticket is missing required Steam ID information. Please provide the following:";
        fields = [
          {
            name: "📋 Required Information",
            value: "**1. Your Steam ID**\n**2. The Steam ID of the player you're reporting**",
            inline: false,
          },
          {
            name: "💡 How to Provide",
            value: "Please send a message in this ticket with both Steam IDs in any of these formats:\n" +
                  "• Steam64 ID: `76561198XXXXXXXXX`\n" +
                  "• Steam Profile URL: `https://steamcommunity.com/profiles/76561198XXXXXXXXX`\n" +
                  "• Steam Vanity URL: `https://steamcommunity.com/id/yourname`\n" +
                  "• STEAM_0 format: `STEAM_0:1:12345678`",
            inline: false,
          },
          {
            name: "📝 Example",
            value: "```My Steam ID: 76561198123456789\nReported player: 76561198987654321```",
            inline: false,
          },
        ];
      } else if (missingType === "suspect") {
        description = "Your report ticket is missing the Steam ID of the player you're reporting.";
        fields = [
          {
            name: "📋 Required Information",
            value: "**The Steam ID of the suspect/player you're reporting**",
            inline: false,
          },
          {
            name: "💡 How to Provide",
            value: "Please send a message with the reported player's Steam ID in any of these formats:\n" +
                  "• Steam64 ID: `76561198XXXXXXXXX`\n" +
                  "• Steam Profile URL: `https://steamcommunity.com/profiles/76561198XXXXXXXXX`\n" +
                  "• Steam Vanity URL: `https://steamcommunity.com/id/theirname`\n" +
                  "• STEAM_0 format: `STEAM_0:1:12345678`",
            inline: false,
          },
        ];
      }
      break;

    case "appeal":
      description = "Your ban appeal ticket is missing your Steam ID.";
      fields = [
        {
          name: "📋 Required Information",
          value: "**Your Steam ID** (the account that was banned)",
          inline: false,
        },
        {
          name: "💡 How to Provide",
          value: "Please send a message with your Steam ID in any of these formats:\n" +
                 "• Steam64 ID: `76561198XXXXXXXXX`\n" +
                 "• Steam Profile URL: `https://steamcommunity.com/profiles/76561198XXXXXXXXX`\n" +
                 "• Steam Vanity URL: `https://steamcommunity.com/id/yourname`\n" +
                 "• STEAM_0 format: `STEAM_0:1:12345678`",
          inline: false,
        },
      ];
      break;

    case "payment":
      description = "Your payment ticket is missing your Steam ID.";
      fields = [
        {
          name: "📋 Required Information",
          value: "**Your Steam ID** (to verify your purchases and inventory)",
          inline: false,
        },
        {
          name: "💡 How to Provide",
          value: "Please send a message with your Steam ID in any of these formats:\n" +
                 "• Steam64 ID: `76561198XXXXXXXXX`\n" +
                 "• Steam Profile URL: `https://steamcommunity.com/profiles/76561198XXXXXXXXX`\n" +
                 "• Steam Vanity URL: `https://steamcommunity.com/id/yourname`",
          inline: false,
        },
      ];
      break;

    case "general":
    default:
      description = "This ticket is missing required Steam ID information.";
      fields = [
        {
          name: "📋 Required Information",
          value: "**Your Steam ID**",
          inline: false,
        },
        {
          name: "💡 How to Provide",
          value: "Please send a message with your Steam ID in any of these formats:\n" +
                 "• Steam64 ID: `76561198XXXXXXXXX`\n" +
                 "• Steam Profile URL: `https://steamcommunity.com/profiles/76561198XXXXXXXXX`\n" +
                 "• Steam Vanity URL: `https://steamcommunity.com/id/yourname`",
          inline: false,
        },
      ];
      break;
  }

  embed.setDescription(description);
  embed.addFields(fields);

  return embed;
}

module.exports = {
  validateSteamIds,
  buildMissingInfoEmbed,
};