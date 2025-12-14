const {
  StringSelectMenuOptionBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
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
  saveTranscript,
  saveTranscriptTxt,
  countMessagesInTicket,
  lastUserMsgTimestamp,
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
      name: config.logCloseEmbed.field_creation || "• Creation Time",
      value: `> <t:${await ticketsDB.get(`${channelID}.creationTime`)}:F>`,
    },
    {
      name: config.logCloseEmbed.field_reason || "• Reason",
      value: `> ${reason}`,
    },
  ]);

  const closedAt = Date.now();
  const closedTime = Math.floor(closedAt / 1000);
  logCloseEmbed.addFields({
    name: config.logCloseEmbed.field_closedAt || "• Closed at",
    value: `> <t:${closedTime}:F>`,
  });

  if (claimUser) {
    logCloseEmbed.addFields({
      name: config.logCloseEmbed.field_claimedBy || "• Claimed By",
      value: `> <@!${claimUser.id}>\n> ${sanitizeInput(claimUser.tag)}`,
    });
  }

  // Build close embed
  const defaultValues = {
    color: "#FF2400",
    title: "Ticket Closed",
    description:
      "This ticket was closed by **{user} ({user.tag})**\nReason: **{reason}**\n\nDeleting ticket in {time} seconds...",
    timestamp: true,
    footer: {
      text: `${interaction.user.tag}`,
      iconURL: `${interaction.user.displayAvatarURL({ extension: "png", size: 1024 })}`,
    },
  };

  const closeEmbed = await configEmbed("closeEmbed", defaultValues);

  const deleteTicketTime =
    config.deleteTicketTime >= 0 ? config.deleteTicketTime : 5;

  if (closeEmbed.data && closeEmbed.data.description) {
    closeEmbed.setDescription(
      closeEmbed.data.description
        .replace(/\{user\}/g, `${interaction.user}`)
        .replace(/\{user\.tag\}/g, sanitizeInput(interaction.user.tag))
        .replace(/\{reason\}/g, reason)
        .replace(/\{time\}/g, `${deleteTicketTime}`),
    );
  }

  // Generate transcript
  let attachment;
  const transcriptType = config.transcriptType || "HTML";
  const transcriptImages =
    config.transcriptImages !== undefined ? config.transcriptImages : false;
  if (transcriptType === "HTML") {
    attachment = await saveTranscript(
      interaction,
      null,
      transcriptImages,
      ticketUserID,
    );
  } else if (transcriptType === "TXT") {
    attachment = await saveTranscriptTxt(interaction, null, ticketUserID);
  }

  // Update ticket status in database
  await ticketsDB.set(`${channelID}.status`, "Closed");
  await ticketsDB.set(`${channelID}.closedAt`, Date.now());
  const ticketMessages = await countMessagesInTicket(interaction.channel);
  await mainDB.add("totalMessages", ticketMessages);
  const lastMsgTime = await lastUserMsgTimestamp(ticketUserID.id, channelID);

  // Send close message in channel (without buttons since it's deleting)
  await interaction.editReply({ embeds: [closeEmbed] });

  // Delete the ticket after the configured time
  const deleteTime = deleteTicketTime * 1000;
  setTimeout(async () => {
    await mainDB.sub("openTickets", 1);
    await ticketsDB.delete(channelID);
    await interaction.channel.delete();
  }, deleteTime);

  // Send to logs with transcript
  let logChannelId = config.logs.ticketClose || config.logs.default;
  let logsChannel = await getChannel(logChannelId);
  if (config.toggleLogs.ticketClose) {
    try {
      await logsChannel.send({ embeds: [logCloseEmbed], files: [attachment] });
    } catch (error) {
      error.errorContext = `[Logging Error]: please make sure to at least configure your default log channel`;
      client.emit("error", error);
    }
  }
  
  await logMessage(
    `${interaction.user.tag} closed the ticket #${channelName} which was created by ${ticketUserID.tag} with the reason: ${reason}`,
  );

  // DM the user with transcript and rating system if enabled
  const sendEmbed = config.DMUserSettings.embed;
  const sendTranscript = config.DMUserSettings.transcript;
  const sendRatingSystem = config.DMUserSettings.ratingSystem.enabled;
  const userPreference = await getUserPreference(ticketUserID.id, "close");
  
  if (userPreference) {
    if (sendEmbed || sendTranscript || sendRatingSystem) {
      const defaultDMValues = {
        color: "#FF2400",
        title: "Ticket Closed",
        description:
          "Your support ticket has been closed. Here is your transcript and other information.",
        thumbnail: interaction.guild.iconURL(),
        timestamp: true,
      };

      const closeDMEmbed = await configEmbed("closeDMEmbed", defaultDMValues);

      closeDMEmbed
        .addFields(
          {
            name: config.closeDMEmbed.field_server || "Server",
            value: `> ${interaction.guild.name}`,
            inline: true,
          },
          {
            name: config.closeDMEmbed.field_ticket || "Ticket",
            value: `> #${sanitizeInput(channelName)}`,
            inline: true,
          },
          {
            name: config.closeDMEmbed.field_category || "Category",
            value: `> ${ticketType}`,
            inline: true,
          },
        )
        .addFields({
          name: config.closeDMEmbed.field_creation || "Ticket Creation Time",
          value: `> <t:${await ticketsDB.get(`${channelID}.creationTime`)}:F>`,
          inline: true,
        })
        .addFields({
          name: "Closed at",
          value: `> <t:${closedTime}:F>`,
          inline: true,
        });

      const options = [];
      for (let i = 1; i <= 5; i++) {
        const option = new StringSelectMenuOptionBuilder()
          .setLabel(`${i} ${i > 1 ? "stars" : "star"}`)
          .setEmoji(config.DMUserSettings.ratingSystem.menu.emoji)
          .setValue(`${i}-star`);

        options.push(option);
      }

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("ratingMenu")
        .setPlaceholder(config.DMUserSettings.ratingSystem.menu.placeholder)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options);

      const actionRowMenu = new ActionRowBuilder().addComponents(selectMenu);

      const defaultRatingValues = {
        color: "#2FF200",
        title: "Ticket Feedback & Rating",
        description:
          "We value your feedback! Please take a moment to share your thoughts and rate our support system. Your rating can be between 1 and 5 stars by using the select menu below. Thank you for helping us improve.",
      };

      const ratingDMEmbed = await configEmbed(
        "ratingDMEmbed",
        defaultRatingValues,
      );

      ratingDMEmbed.setFooter({
        text: `Ticket: #${channelName} | Category: ${ticketType}`,
      });

      const messageDM = {};

      if (sendEmbed) {
        messageDM.embeds = [closeDMEmbed];
      }

      if (sendTranscript) {
        messageDM.files = [attachment];
      }

      try {
        if (sendRatingSystem === false) {
          await ticketUserID.send(messageDM);
        }
        if (sendRatingSystem === true) {
          if (Object.keys(messageDM).length !== 0) {
            await ticketUserID.send(messageDM);
          }
          if (lastMsgTime !== null) {
            await mainDB.set(`ratingMenuOptions`, options);
            await ticketUserID.send({
              embeds: [ratingDMEmbed],
              components: [actionRowMenu],
            });
          }
        }
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