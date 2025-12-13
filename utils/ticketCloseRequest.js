const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require("discord.js");
const { ticketsDB, ticketCategories } = require("../init.js");
const { configEmbed, sanitizeInput, logMessage } = require("./mainUtils.js");

async function closeRequestTicket(interaction, reason = "No reason provided.") {
  const channelId = interaction.channel.id;

  const ticketButton = await ticketsDB.get(`${channelId}.button`);
  const ticketOwnerId = await ticketsDB.get(`${channelId}.owner`);

  if (!ticketOwnerId) {
    throw new Error("Ticket owner could not be resolved.");
  }

  const closeButton = new ButtonBuilder()
    .setCustomId("closeTicket")
    .setLabel(config.closeRequestButton.label)
    .setEmoji(config.closeRequestButton.emoji)
    .setStyle(ButtonStyle[config.closeRequestButton.style]);

  const row = new ActionRowBuilder().addComponents(closeButton);

  const defaultValues = {
    color: "#FF2400",
    title: "Ticket Closure Request",
    description:
      "**Staff member {staff} ({staff.tag})** has requested to close this ticket.\n\nTicket owner: **{owner}**\nReason: **{reason}**\n\nPlease confirm by pressing the button below.",
    timestamp: true,
    footer: {
      text: interaction.user.tag,
      iconURL: interaction.user.displayAvatarURL({ extension: "png", size: 1024 }),
    },
  };

  const closeRequestEmbed = await configEmbed(
    "closeRequestEmbed",
    defaultValues,
  );

  if (closeRequestEmbed.data?.description) {
    closeRequestEmbed.setDescription(
      closeRequestEmbed.data.description
        .replace(/\{staff\}/g, `${interaction.user}`)
        .replace(/\{staff\.tag\}/g, sanitizeInput(interaction.user.tag))
        .replace(/\{owner\}/g, `<@${ticketOwnerId}>`)
        .replace(/\{reason\}/g, sanitizeInput(reason)),
    );
  }

  const requestReply = {
    content: `<@${ticketOwnerId}>`,
    embeds: [closeRequestEmbed],
    components: [row],
  };

  if (config.commands.closerequest.pingRoles) {
    const category = ticketCategories[ticketButton];
    if (category?.ping_role_ids?.length) {
      requestReply.content +=
        " " +
        category.ping_role_ids.map(id => `<@&${id}>`).join(" ");
    }
  }

  await interaction.editReply(requestReply);

  await logMessage(
    `${interaction.user.tag} requested to close the ticket.\n\nIf your issue has been resolved please press Accept`,
  );
}

module.exports = {
  closeRequestTicket,
};
