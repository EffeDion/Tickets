const {
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require("discord.js");
const { mainDB, ticketsDB, client, ticketCategories } = require("../init.js");
const {
  configEmbed,
  getUser,
  sanitizeInput,
  logMessage,
  getUserPreference,
  getChannel,
  logError,
} = require("./mainUtils.js");

async function closeTicket(interaction, reason = "No reason provided.") {
  const channelID = interaction.channel.id;
  const channelName = interaction.channel.name;
  
  await ticketsDB.set(`${channelID}.closeUserID`, interaction.user.id);
  
  const ticketUserID = await getUser(
    await ticketsDB.get(`${channelID}.userID`),
  );
  const claimUserID = await ticketsDB.get(`${channelID}.claimUser`);
  let claimUser;
  
  if (claimUserID) {
    claimUser = await getUser(claimUserID);
  }
  
  const ticketType = await ticketsDB.get(`${channelID}.ticketType`);
  const ticketButton = await ticketsDB.get(`${channelID}.button`);

  // Build log embed
  const logDefaultValues = {
    color: "#FF2400",
    title: "Ticket Logs | Ticket Closed",
    timestamp: true,
    thumbnail: `${interaction.user.displayAvatarURL({ extension: "png", size: 1024 })}`,
    footer: {
      text: `${interaction.user.tag}`,
      iconURL: `${interaction.user.displayAvatarURL({ extension: "png", size: 1024 })}`,
    },
  };

  const logCloseEmbed = await configEmbed("logCloseEmbed", logDefaultValues);

  logCloseEmbed.addFields([
    {
      name: config.logCloseEmbed.field_staff || "• Closed By",
      value: `> <@!${interaction.user.id}>\n> ${sanitizeInput(interaction.user.tag)}`,
    },
    {
      name: config.logCloseEmbed.field_user || "• Ticket Creator",
      value: `> <@!${ticketUserID.id}>\n> ${sanitizeInput(ticketUserID.tag)}`,
    },
    {
      name: config.logCloseEmbed.field_ticket || "• Ticket",
      value: `> #${sanitizeInput(channelName)}\n> ${ticketType}`,
    },
    {
      name: config.logCloseEmbed.field_reason || "• Reason",
      value: `> ${reason}`,
    },
  ]);

  if (claimUser) {
    logCloseEmbed.addFields({
      name: config.logCloseEmbed.field_claimedBy || "• Claimed By",
      value: `> <@!${claimUser.id}>\n> ${sanitizeInput(claimUser.tag)}`,
    });
  }

  // Build action row with buttons/menu
  let row = new ActionRowBuilder();
  if (config.closeEmbed.useMenu) {
    const options = [];

    if (config.closeEmbed.reOpenButton !== false) {
      const reopenOption = new StringSelectMenuOptionBuilder()
        .setLabel(config.reOpenButton.label)
        .setDescription(config.closeEmbed.reopenDescription)
        .setValue("reOpen")
        .setEmoji(config.reOpenButton.emoji);
      options.push(reopenOption);
    }

    if (config.closeEmbed.transcriptButton !== false) {
      const transcriptOption = new StringSelectMenuOptionBuilder()
        .setLabel(config.transcriptButton.label)
        .setDescription(config.closeEmbed.transcriptDescription)
        .setValue("createTranscript")
        .setEmoji(config.transcriptButton.emoji);
      options.push(transcriptOption);
    }

    if (config.closeEmbed.deleteButton !== false) {
      const deleteOption = new StringSelectMenuOptionBuilder()
        .setLabel(config.deleteButton.label)
        .setDescription(config.closeEmbed.deleteDescription)
        .setValue("deleteTicket")
        .setEmoji(config.deleteButton.emoji);
      options.push(deleteOption);
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("closeMenu")
      .setPlaceholder(config.closeEmbed.menuPlaceholder || "Select an option")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(options);

    if (selectMenu.options.length > 0) {
      row.addComponents(selectMenu);
      await mainDB.set("closeMenuOptions", {
        options,
        placeholder: config.closeEmbed.menuPlaceholder || "Select an option",
      });
    }
  } else {
    const reOpenButton =
      config.closeEmbed.reOpenButton !== false
        ? new ButtonBuilder()
            .setCustomId("reOpen")
            .setLabel(config.reOpenButton.label)
            .setEmoji(config.reOpenButton.emoji)
            .setStyle(ButtonStyle[config.reOpenButton.style])
        : null;

    const transcriptButton =
      config.closeEmbed.transcriptButton !== false
        ? new ButtonBuilder()
            .setCustomId("createTranscript")
            .setLabel(config.transcriptButton.label)
            .setEmoji(config.transcriptButton.emoji)
            .setStyle(ButtonStyle[config.transcriptButton.style])
        : null;

    const deleteButton =
      config.closeEmbed.deleteButton !== false
        ? new ButtonBuilder()
            .setCustomId("deleteTicket")
            .setLabel(config.deleteButton.label)
            .setEmoji(config.deleteButton.emoji)
            .setStyle(ButtonStyle[config.deleteButton.style])
        : null;

    if (reOpenButton) row.addComponents(reOpenButton);
    if (transcriptButton) row.addComponents(transcriptButton);
    if (deleteButton) row.addComponents(deleteButton);
  }

  // Build close embed
  const defaultValues = {
    color: "#FF2400",
    title: "Ticket Closed",
    description:
      "This ticket was closed by **{user} ({user.tag})**\nReason: **{reason}**",
    timestamp: true,
    footer: {
      text: `${interaction.user.tag}`,
      iconURL: `${interaction.user.displayAvatarURL({ extension: "png", size: 1024 })}`,
    },
  };

  const closeEmbed = await configEmbed("closeEmbed", defaultValues);

  if (closeEmbed.data && closeEmbed.data.description) {
    closeEmbed.setDescription(
      closeEmbed.data.description
        .replace(/\{user\}/g, `${interaction.user}`)
        .replace(/\{user\.tag\}/g, sanitizeInput(interaction.user.tag))
        .replace(/\{reason\}/g, reason),
    );
  }

  // Update ticket status in database
  await ticketsDB.set(`${channelID}.status`, "Closed");
  await ticketsDB.set(`${channelID}.closedAt`, Date.now());
  await mainDB.sub("openTickets", 1);

  // Send close message in channel
  let messageID;
  const options = { embeds: [closeEmbed], fetchReply: true };
  if (row.components.length > 0) {
    options.components = [row];
  }
  
  await interaction.editReply(options).then(async function (message) {
    messageID = message.id;
  });
  
  await ticketsDB.set(`${channelID}.closeMsgID`, messageID);

  // Send to logs
  let logChannelId = config.logs.ticketClose || config.logs.default;
  let logsChannel = await getChannel(logChannelId);
  if (config.toggleLogs.ticketClose) {
    try {
      await logsChannel.send({ embeds: [logCloseEmbed] });
    } catch (error) {
      error.errorContext = `[Logging Error]: please make sure to at least configure your default log channel`;
      client.emit("error", error);
    }
  }
  
  await logMessage(
    `${interaction.user.tag} closed the ticket #${channelName} which was created by ${ticketUserID.tag} with the reason: ${reason}`,
  );

  // DM the user if enabled
  if (config.closeDMEmbed.enabled && interaction.user.id !== ticketUserID.id) {
    const defaultDMValues = {
      color: "#FF0000",
      title: "Ticket Closed",
      description:
        "Your ticket **#{ticketName}** has been closed by {user} in **{server}**.",
    };

    const closeDMEmbed = await configEmbed("closeDMEmbed", defaultDMValues);

    if (closeDMEmbed.data && closeDMEmbed.data.description) {
      closeDMEmbed.setDescription(
        closeDMEmbed.data.description
          .replace(/\{ticketName\}/g, `${channelName}`)
          .replace(/\{user\}/g, `<@!${interaction.user.id}>`)
          .replace(/\{server\}/g, `${interaction.guild.name}`),
      );
    }

    const userPreference = await getUserPreference(ticketUserID.id, "close");
    if (userPreference) {
      try {
        await ticketUserID.send({ embeds: [closeDMEmbed] });
      } catch (error) {
        error.errorContext = `[Close Ticket Error]: failed to DM ${ticketUserID.tag} because their DMs were closed.`;
        await logError("ERROR", error);
        
        const defaultErrorValues = {
          color: "#FF0000",
          title: "DMs Disabled",
          description:
            "The bot could not DM **{user} ({user.tag})** because their DMs were closed.\nPlease enable `Allow Direct Messages` in this server to receive further information from the bot!\n\nFor help, please read [this article](https://support.discord.com/hc/en-us/articles/217916488-Blocking-Privacy-Settings).",
          timestamp: true,
          thumbnail: `${ticketUserID.displayAvatarURL({ extension: "png", size: 1024 })}`,
          footer: {
            text: `${ticketUserID.tag}`,
            iconURL: `${ticketUserID.displayAvatarURL({ extension: "png", size: 1024 })}`,
          },
        };

        const dmErrorEmbed = await configEmbed(
          "dmErrorEmbed",
          defaultErrorValues,
        );

        if (dmErrorEmbed.data && dmErrorEmbed.data.description) {
          dmErrorEmbed.setDescription(
            dmErrorEmbed.data.description
              .replace(/\{user\}/g, ticketUserID)
              .replace(/\{user\.tag\}/g, sanitizeInput(ticketUserID.tag)),
          );
        }

        let logChannelId = config.logs.DMErrors || config.logs.default;
        let logChannel = await getChannel(logChannelId);

        let dmErrorReply = {
          embeds: [dmErrorEmbed],
        };

        if (config.dmErrorEmbed.pingUser) {
          dmErrorReply.content = `<@${ticketUserID.id}>`;
        }

        if (config.toggleLogs.DMErrors) {
          try {
            await logChannel.send(dmErrorReply);
          } catch (error) {
            error.errorContext = `[Logging Error]: please make sure to at least configure your default log channel`;
            client.emit("error", error);
          }
        }
        
        await logMessage(
          `The bot could not DM ${ticketUserID.tag} because their DMs were closed`,
        );
      }
    }
  }
}

module.exports = {
  closeTicket,
};