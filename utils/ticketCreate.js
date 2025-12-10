const {
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ChannelType,
} = require("discord.js");
const dotenv = require("dotenv");
dotenv.config({ quiet: true });

const { client, mainDB, ticketsDB } = require("../init.js");
const {
  configEmbed,
  sanitizeInput,
  logMessage,
  getChannel,
  addTicketCreator,
  findAvailableCategory,
} = require("./mainUtils.js");
const { autoResponses } = require("./autoResponses.js");

// New imports
const { getFullPlayerProfile } = require("./steamUtils.js");
const {
  collectSteamIdsFromAnswers,
  splitReporterAndTargets,
  buildReporterField,
  buildTargetFields,
  buildAdminSteamEmbed,
} = require("./reportUtils.js");

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

async function createTicket(
  interaction,
  category,
  customId,
  timeObject,
  withModal = true,
) {
  const automatedResponses = [];

  const embedDescription = category.description
    .replace(/\{user\}/g, interaction.user)
    .replace(/\{user.tag\}/g, interaction.user.username);

  const defaultValues = {
    color: category.color || "#2FF200",
    description: embedDescription,
    timestamp: true,
    thumbnail: `${interaction.user.displayAvatarURL({ extension: "png", size: 1024 })}`,
    footer: {
      text: `${interaction.user.tag}`,
      iconURL: `${interaction.user.displayAvatarURL({ extension: "png", size: 1024 })}`,
    },
  };

  const ticketOpenEmbed = await configEmbed("ticketOpenEmbed", defaultValues);

  ticketOpenEmbed.setDescription(embedDescription);
  ticketOpenEmbed.setColor(category.color || "#2FF200");
  ticketOpenEmbed.setAuthor({
    name: `${category.embedTitle}`,
    iconURL: `${interaction.user.displayAvatarURL({ extension: "png", size: 1024 })}`,
  });

const modalAnswers = [];
if (withModal) {
  for (
    let questionIndex = 0;
    questionIndex < category.questions.length;
    questionIndex++
  ) {
    const question = category.questions[questionIndex];
    const { label } = question;
    let rawValue = interaction.fields.getTextInputValue(
      `question${questionIndex + 1}`,
    );

    // Always store raw text for Steam parsing
    modalAnswers.push({
      label,
      value: rawValue,
    });

    // If answer is blank, don't display it in the embed
    if (!rawValue || !rawValue.trim() || rawValue.trim().length === 0) {
      continue;
    }

    // Auto responses (only if non-empty)
    if (config.autoResponses.enabled) {
      const autoResponse = await autoResponses(rawValue, interaction.member);
      if (autoResponse !== null) {
        automatedResponses.push(...autoResponse.matches);
      }
    }

    // Format for embed
    let valueToShow = rawValue;
    if (category?.useCodeBlocks) {
      valueToShow = `\`\`\`${valueToShow}\`\`\``;
    } else {
      valueToShow = `>>> ${valueToShow}`;
    }

    // Add to ticket embed only if not empty
    ticketOpenEmbed.addFields({
      name: `${label}`,
      value: valueToShow,
    });
  }
}

  // Working hours field
  if (config.workingHours.enabled && config.workingHours.addField) {
    let workingHoursText = "";
    if (config.workingHours.valueDays === "ALL") {
      const currentDay = timeObject.userCurrentTime
        .format("dddd")
        .toLowerCase();
      for (const day in timeObject.workingHours) {
        const { min, max } = timeObject.workingHours[day];
        const isCurrentDay = day === currentDay;
        const dayText = isCurrentDay
          ? `**${day.charAt(0).toUpperCase() + day.slice(1)}**`
          : day.charAt(0).toUpperCase() + day.slice(1);
        let openTime = min || config.workingHours.default.min;
        let closeTime = max || config.workingHours.default.max;

        const openTimeToday = timeObject.userCurrentTime
          .clone()
          .startOf("day")
          .set({
            hour: openTime.split(":")[0],
            minute: openTime.split(":")[1],
          });

        const closeTimeToday = timeObject.userCurrentTime
          .clone()
          .startOf("day")
          .set({
            hour: closeTime.split(":")[0],
            minute: closeTime.split(":")[1],
          });

        const openingTimestamp = `<t:${openTimeToday.unix()}:t>`;
        const closingTimestamp = `<t:${closeTimeToday.unix()}:t>`;

        const workingHoursField = config.workingHours.fieldValue
          ? `${config.workingHours.fieldValue}\n`
          : `> {day}: {openingTime} to {closingTime}\n`;
        workingHoursText += workingHoursField
          .replace(/\{day\}/g, dayText)
          .replace(/\{openingTime\}/g, openingTimestamp)
          .replace(/\{closingTime\}/g, closingTimestamp);
      }
    } else if (config.workingHours.valueDays === "TODAY") {
      workingHoursText +=
        `${config.workingHours.fieldValue || "> {day}: {openingTime} to {closingTime}"}`
          .replace(
            /\{day\}/g,
            timeObject.dayToday.charAt(0).toUpperCase() +
              timeObject.dayToday.slice(1),
          )
          .replace(
            /\{openingTime\}/g,
            `<t:${timeObject.openingTimeToday.unix()}:t>`,
          )
          .replace(
            /\{closingTime\}/g,
            `<t:${timeObject.closingTimeToday.unix()}:t>`,
          );
    }
    ticketOpenEmbed.addFields({
      name: config.workingHours.fieldTitle || "Working Hours",
      value: workingHoursText,
    });
  }

  // Buttons / menu
  let answerRow = new ActionRowBuilder();
  if (config.ticketOpenEmbed.useMenu) {
    const options = [];

    const closeOption = new StringSelectMenuOptionBuilder()
      .setLabel(config.closeButton.label)
      .setDescription(config.ticketOpenEmbed.closeDescription)
      .setValue("closeTicket")
      .setEmoji(config.closeButton.emoji);
    options.push(closeOption);

    if (config.claimFeature) {
      const claimOption = new StringSelectMenuOptionBuilder()
        .setLabel(config.claimButton.label)
        .setDescription(config.ticketOpenEmbed.claimDescription)
        .setValue("ticketclaim")
        .setEmoji(config.claimButton.emoji);
      options.push(claimOption);
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("ticketOpenMenu")
      .setPlaceholder(
        config.ticketOpenEmbed.menuPlaceholder || "Select an option",
      )
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(options);

    answerRow.addComponents(selectMenu);
    await mainDB.set("ticketOpenMenuOptions", {
      options,
      placeholder: config.ticketOpenEmbed.menuPlaceholder || "Select an option",
    });
  } else {
    const closeButton = new ButtonBuilder()
      .setCustomId("closeTicket")
      .setLabel(config.closeButton.label)
      .setEmoji(config.closeButton.emoji)
      .setStyle(ButtonStyle[config.closeButton.style]);

    answerRow.addComponents(closeButton);

    if (config.claimFeature) {
      const claimButton = new ButtonBuilder()
        .setCustomId("ticketclaim")
        .setLabel(config.claimButton.label)
        .setEmoji(config.claimButton.emoji)
        .setStyle(ButtonStyle[config.claimButton.style]);

      answerRow.addComponents(claimButton);
    }
  }

  try {
    const TICKETCOUNT = await mainDB.get("totalTickets");
    const USERNAME = interaction.user.username;
    const configValue = category.ticketName;
    const categoryIDs = category.categoryID;
    const selectedCategoryID = await findAvailableCategory(categoryIDs);
    const ticketCreatorPerms = category?.permissions?.ticketCreator;
    const allowedCreatorPerms = ticketCreatorPerms?.open?.allow || [
      "ViewChannel",
      "SendMessages",
      "EmbedLinks",
      "AttachFiles",
      "ReadMessageHistory",
    ];
    const deniedCreatorPerms = ticketCreatorPerms?.open?.deny || [];
    const openAllowCreator = allowedCreatorPerms.map(
      (permission) => PermissionFlagsBits[permission],
    );
    const openDenyCreator = deniedCreatorPerms.map(
      (permission) => PermissionFlagsBits[permission],
    );
    const rolesPerms = category?.permissions?.supportRoles;
    const allowedRolePerms = rolesPerms?.open?.allow || [
      "ViewChannel",
      "SendMessages",
      "EmbedLinks",
      "AttachFiles",
      "ReadMessageHistory",
    ];
    const deniedRolePerms = rolesPerms?.open?.deny || [];
    const openAllowRoles = allowedRolePerms.map(
      (permission) => PermissionFlagsBits[permission],
    );
    const openDenyRoles = deniedRolePerms.map(
      (permission) => PermissionFlagsBits[permission],
    );

    let channelName;
    switch (configValue.toLowerCase()) {
      case "category-username":
        channelName = `${category.name}-${USERNAME}`;
        break;
      case "category-ticketcount":
        channelName = `${category.name}-${TICKETCOUNT}`;
        break;
      case "username-ticketcount":
        channelName = `${USERNAME}-${TICKETCOUNT}`;
        break;
      case "username-category":
        channelName = `${USERNAME}-${category.name}`;
        break;
      case "username-category-ticketcount":
        channelName = `${USERNAME}-${category.name}-${TICKETCOUNT}`;
        break;
      case "category-username-ticketcount":
        channelName = `${category.name}-${USERNAME}-${TICKETCOUNT}`;
        break;
      default:
        channelName = `${category.name}-${TICKETCOUNT}`;
        console.log(
          `WARNING: Invalid category ticketName configuration value: ${configValue}, falling back to category-ticketcount as the value.`,
        );
    }
    const nameEmoji = category.nameEmoji ?? "";
    if (nameEmoji !== "") {
      channelName = `${nameEmoji}${channelName}`;
    }

    await interaction.guild.channels
      .create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: selectedCategoryID,
        rateLimitPerUser: category.slowmode || 0,
        topic: category.ticketTopic
          .replace(/\{user\}/g, interaction.user.tag)
          .replace(/\{type\}/g, category.name),
        permissionOverwrites: [
          {
            id: interaction.guild.id,
            deny: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
            ],
          },
          {
            id: interaction.user.id,
            allow: openAllowCreator,
            deny: openDenyCreator,
          },
          {
            id: process.env.CLIENT_ID,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
          ...category.support_role_ids.map((roleId) => ({
            id: roleId,
            allow: openAllowRoles,
            deny: openDenyRoles,
          })),
        ],
      })
      .then(async (channel) => {
        // ------------------------------------------------------------------
        // Steam / Enardo stats + report logic based on CHANNEL NAME
        // ------------------------------------------------------------------
        const channelNameLower = channel.name.toLowerCase();
        const skipSteam = channelNameLower.includes("discord");
        const isReportChannel = channelNameLower.includes("report");

        let reporterProfile = null;
        let targetsProfiles = [];

        if (!skipSteam && modalAnswers.length > 0) {
          try {
            const allIds = collectSteamIdsFromAnswers(modalAnswers);
            const { reporterId, targetIds } = splitReporterAndTargets(
              allIds,
              isReportChannel,
            );

            if (reporterId) {
              reporterProfile = await getFullPlayerProfile(reporterId);
            }

            if (isReportChannel && targetIds && targetIds.length > 0) {
              const limitedTargets = targetIds.slice(0, 5);
              for (const tId of limitedTargets) {
                const profile = await getFullPlayerProfile(tId);
                if (profile) {
                  targetsProfiles.push(profile);
                }
              }
            }

            // Add user-visible fields to the ticket embed
            const reporterField = buildReporterField(
              reporterProfile,
              isReportChannel,
            );
            const targetFields = buildTargetFields(targetsProfiles);

            const fields = [];
            if (reporterField) fields.push(reporterField);
            if (targetFields.length > 0) fields.push(...targetFields);

            if (fields.length > 0) {
              ticketOpenEmbed.addFields(fields);
            }
          } catch (err) {
            console.error(
              "[Ticket] Error while fetching Steam/Enardo stats:",
              err,
            );
          }
        }

        // ------------------------------------------------------------------
        // Existing logic: send message in ticket channel
        // ------------------------------------------------------------------
        let textContent =
          category.textContent !== undefined
            ? category.textContent
            : "Please wait for the support staff to check your ticket!";
        textContent = textContent
          .replace(/\{user\}/g, interaction.user)
          .replace(/\{user\.tag\}/g, sanitizeInput(interaction.user.tag));
        const pingRoles =
          category.pingRoles && category.ping_role_ids.length > 0;
        if (pingRoles) {
          const rolesToMention = category.ping_role_ids
            .map((roleId) => `<@&${roleId}>`)
            .join(" ");
          textContent = textContent.replace(
            /\{support-roles\}/g,
            rolesToMention,
          );
        }

        await channel
          .send({
            content: textContent,
            embeds: [ticketOpenEmbed],
            components: [answerRow],
            fetchReply: true,
          })
          .then(async (message) => {
            const defaultValues = {
              color: "#2FF200",
              title: "Ticket Created!",
              description:
                "Your new ticket ({channel}) has been created, **{user}**!",
              timestamp: true,
              footer: {
                text: `${interaction.user.tag}`,
                iconURL: `${interaction.user.displayAvatarURL({ extension: "png", size: 1024 })}`,
              },
            };

            const newTicketEmbed = await configEmbed(
              "newTicketEmbed",
              defaultValues,
            );

            if (newTicketEmbed.data && newTicketEmbed.data.description) {
              newTicketEmbed.setDescription(
                newTicketEmbed.data.description
                  .replace(/\{channel\}/g, `<#${channel.id}>`)
                  .replace(
                    /\{user\}/g,
                    `${sanitizeInput(interaction.user.username)}`,
                  ),
              );
            }
            const actionRow4 = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setURL(`${channel.url}`)
                .setLabel(config.newTicketButton.label)
                .setEmoji(config.newTicketButton.emoji),
            );
            await interaction.editReply({
              embeds: [newTicketEmbed],
              components: [actionRow4],
              flags: MessageFlags.Ephemeral,
            });

            const creationTime = Math.floor(new Date().getTime() / 1000);

            await ticketsDB.set(`${channel.id}`, {
              userID: interaction.user.id,
              ticketType: category.name,
              button: customId,
              msgID: message.id,
              claimed: false,
              claimUser: "",
              status: "Open",
              closeUserID: "",
              creationTime: creationTime,
              addedUsers: [],
              addedRoles: [],
              closedAt: 0,
            });

            await mainDB.add("openTickets", 1);
            await addTicketCreator(interaction.user.id);

            const logDefaultValues = {
              color: "#2FF200",
              title: "Ticket Logs | Ticket Created",
              timestamp: true,
              thumbnail: `${interaction.user.displayAvatarURL({ extension: "png", size: 1024 })}`,
              footer: {
                text: `${interaction.user.tag}`,
                iconURL: `${interaction.user.displayAvatarURL({ extension: "png", size: 1024 })}`,
              },
            };

            const logTicketOpenEmbed = await configEmbed(
              "logTicketOpenEmbed",
              logDefaultValues,
            );

            logTicketOpenEmbed.addFields([
              {
                name:
                  config.logTicketOpenEmbed.field_creator || "• Ticket Creator",
                value: `> <@!${interaction.user.id}>\n> ${sanitizeInput(interaction.user.tag)}`,
              },
              {
                name: config.logTicketOpenEmbed.field_ticket || "• Ticket",
                value: `> #${sanitizeInput(channel.name)}`,
              },
              {
                name:
                  config.logTicketOpenEmbed.field_creation || "• Creation Time",
                value: `> <t:${creationTime}:F>`,
              },
            ]);

            let logChannelId = config.logs.ticketCreate || config.logs.default;
            let logChannel = await getChannel(logChannelId);
            if (config.toggleLogs.ticketCreate) {
              try {
                await logChannel.send({
                  embeds: [logTicketOpenEmbed],
                });
              } catch (error) {
                error.errorContext =
                  "[Logging Error]: please make sure to at least configure your default log channel";
                client.emit("error", error);
              }
            }

            // Admin-only Steam overview embed
            try {
              if (
                (reporterProfile || targetsProfiles.length > 0) &&
                config.toggleLogs.ticketCreate &&
                logChannel
              ) {
                const adminSteamEmbed = buildAdminSteamEmbed(
                  interaction,
                  channel,
                  reporterProfile,
                  targetsProfiles,
                  isReportChannel,
                );
                if (adminSteamEmbed) {
                  await logChannel.send({ embeds: [adminSteamEmbed] });
                }
              }
            } catch (err) {
              console.error(
                "[Ticket] Failed to send admin Steam overview embed:",
                err,
              );
            }

            await logMessage(
              `${interaction.user.tag} created the ticket #${channel.name}`,
            );

            await message.pin().then(async () => {
              const fetchedMessages = await message.channel.messages.fetch({
                limit: 10,
              });
              const systemMessage = fetchedMessages.find(
                (msg) => msg.system === true,
              );
              if (systemMessage) {
                await systemMessage.delete();
              }
            });

            if (automatedResponses.length > 0) {
              const defaultValues = {
                color: category.color || "#2FF200",
                description: "Q: {question}\nA: {answer}\n\n",
                timestamp: true,
                thumbnail: `${interaction.user.displayAvatarURL({ extension: "png", size: 1024 })}`,
                footer: {
                  text: `${interaction.user.tag}`,
                  iconURL: `${interaction.user.displayAvatarURL({ extension: "png", size: 1024 })}`,
                },
              };

              const autoResponsesEmbed = await configEmbed(
                "autoResponsesEmbed",
                defaultValues,
              );

              if (
                autoResponsesEmbed.data &&
                autoResponsesEmbed.data.description
              ) {
                autoResponsesEmbed.setDescription(
                  automatedResponses
                    .map((response) =>
                      autoResponsesEmbed.data.description
                        .replace(/\{question\}/g, response.question)
                        .replace(/\{answer\}/g, response.answer),
                    )
                    .join(""),
                );
              }

              setTimeout(async () => {
                await channel.send({
                  embeds: [autoResponsesEmbed],
                });
              }, 4000);
            }
          });

        await channel
          .send({ content: `<@${interaction.user.id}>` })
          .then((message) => {
            message.delete();
          });

        if (pingRoles && category.ghostPingRoles) {
          const rolesToMention = category.ping_role_ids
            .map((roleId) => `<@&${roleId}>`)
            .join(" ");
          await channel.send({ content: rolesToMention }).then((message) => {
            message.delete();
          });
        }

        if (
          timeRegex.test(timeObject.openingTime) &&
          timeRegex.test(timeObject.closingTime)
        ) {
          if (
            config.workingHours.enabled &&
            !timeObject.blockTicketCreation &&
            config.workingHours.outsideWarning
          ) {
            if (
              timeObject.userCurrentTime.isBefore(
                timeObject.openingTimeToday,
              ) ||
              timeObject.userCurrentTime.isAfter(timeObject.closingTimeToday)
            ) {
              const defaultValues = {
                color: "#FF0000",
                title: "Outside Working Hours",
                description:
                  "You created a ticket outside of our working hours. Please be aware that our response time may be delayed.\nOur working hours for today are from {openingTime} to {closingTime}.",
                timestamp: true,
              };

              const outsideWorkingHoursEmbed = await configEmbed(
                "outsideWorkingHoursEmbed",
                defaultValues,
              );

              if (
                outsideWorkingHoursEmbed.data &&
                outsideWorkingHoursEmbed.data.description
              ) {
                outsideWorkingHoursEmbed.setDescription(
                  outsideWorkingHoursEmbed.data.description
                    .replace(
                      /\{openingTime\}/g,
                      `<t:${timeObject.openingTimeToday.unix()}:t>`,
                    )
                    .replace(
                      /\{closingTime\}/g,
                      `<t:${timeObject.closingTimeToday.unix()}:t>`,
                    ),
                );
              }
              setTimeout(async () => {
                await channel.send({
                  embeds: [outsideWorkingHoursEmbed],
                });
              }, 3000);
            }
          }
        }
      });

    await mainDB.add("totalTickets", 1);
  } catch (error) {
    console.error("Error creating ticket:", error);
    return null;
  }
}

module.exports = {
  createTicket,
};
