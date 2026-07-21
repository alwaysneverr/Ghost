import {
  SlashCommandBuilder,
  InteractionContextType,
  ApplicationIntegrationType,
  MessageFlags,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  RESTJSONErrorCodes,
} from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('dm')
    .setDescription('Send a DM to a user.')
    .setContexts([
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    ])
    .setIntegrationTypes([
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    ])
    .addUserOption((option) =>
      option.setName('user').setDescription('The user to DM').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('message').setDescription('The message to send').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('image').setDescription('Image URL to include in the embed').setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('button_label')
        .setDescription('Label for an optional button')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('button_url')
        .setDescription('URL for the button (requires button_label)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const target = interaction.options.getUser('user');
    const message = interaction.options.getString('message');
    const imageUrl = interaction.options.getString('image');
    const buttonLabel = interaction.options.getString('button_label');
    const buttonUrl = interaction.options.getString('button_url');

    // Build the embed
    const embed = new EmbedBuilder()
      .setDescription(message)
      .setColor(0x5865f2)
      .setFooter({ text: `Sent by ${interaction.user.username}` })
      .setTimestamp();

    if (imageUrl) embed.setImage(imageUrl);

    // Build optional button
    const components = [];
    if (buttonLabel && buttonUrl) {
      const button = new ButtonBuilder()
        .setLabel(buttonLabel)
        .setURL(buttonUrl)
        .setStyle(ButtonStyle.Link);
      components.push(new ActionRowBuilder().addComponents(button));
    }

    try {
      await target.send({ embeds: [embed], components });
      await interaction.editReply(`✅ DM sent to ${target.username}`);
    } catch (error) {
      const reason = getDMFailureReason(error, target);
      await interaction.editReply(`❌ Could not send DM to ${target.username} — ${reason}`);
    }
  },
};

function getDMFailureReason(error, target) {
  // Discord API error codes
  switch (error?.code) {
    case RESTJSONErrorCodes.CannotSendMessagesToThisUser:
      // Memakai variabel 'target' di sini agar ESLint tidak error (no-unused-vars)
      return `${target.username} has DMs disabled or is not accepting messages from non-friends.`;
    case RESTJSONErrorCodes.UnknownUser:
      return 'that user does not exist.';
    case RESTJSONErrorCodes.UnknownChannel:
      return 'the DM channel could not be opened.';
    case RESTJSONErrorCodes.MissingPermissions:
      return 'the bot is missing permissions to send DMs.';
    case RESTJSONErrorCodes.RequestEntityTooLarge:
      return 'the message or image is too large to send.';
    case RESTJSONErrorCodes.InvalidFormBody:
      return 'the image URL is invalid or could not be loaded.';
    default:
      // Network or unknown errors
      if (error?.status === 429) return 'the bot is being rate limited, try again in a moment.';
      if (error?.status >= 500) return 'Discord is experiencing issues, try again later.';
      return `an unexpected error occurred (code: ${error?.code ?? error?.status ?? 'unknown'}).`;
  }
}
