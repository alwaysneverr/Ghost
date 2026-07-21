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
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const target = interaction.options.getUser('user');
    const message = interaction.options.getString('message');

    try {
      await target.send(message);
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
      return `Captain, ${target.username} has DMs disabled! I can't send shit to them. Or... they're not accepting messages from non-friends. Wow, you don't have many friends, don'tcha?`;
    case RESTJSONErrorCodes.UnknownUser:
      return `Captain, I might be called Ghost before, but that doesn't mean I can reach people that doesn't exist.`;
    case RESTJSONErrorCodes.UnknownChannel:
      return `I know you're powerful and all, Captain, but that still means jackshit if the target doesn't have a DM channel.`;
    case RESTJSONErrorCodes.MissingPermissions:
      return 'Captain, you forgot to give me the right permissions. Dumbass.';
    case RESTJSONErrorCodes.RequestEntityTooLarge:
      return `Stop yapping so much! I literally can't even remember what you said! Those images are also too pristine, I can't send them over!`;
    case RESTJSONErrorCodes.InvalidFormBody:
      return `Captain, you sure you want me to send a blank image to them? Really?`;
    default:
      // Network or unknown errors
      if (error?.status === 429)
        return `Sorry, Captain, I got too much stuff to handle. Try again in a few seconds.`;
      if (error?.status >= 500)
        return `The multiverse itself is erroring out. Not much I can do when that's the case. Maybe we should ask Sophitia for help?`;
      return `Whoa! I keep seeing this number over and over. What's this all about? (code: ${error?.code ?? error?.status ?? 'unknown'}).`;
  }
}
