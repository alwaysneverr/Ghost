import {
  SlashCommandBuilder,
  InteractionContextType,
  ApplicationIntegrationType,
  MessageFlags,
} from 'discord.js';
import { isBotAdmin } from '../access.js';

export default {
  data: new SlashCommandBuilder()
    .setName('echo')
    .setDescription('Make her say something in this channel. Owner and team admins only.')
    // Hides it from non-admins in servers. Discord ignores this in DMs and for user
    // installs, so the check in execute() is what actually enforces it.
    .setDefaultMemberPermissions(0)
    .setContexts([
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    ])
    .setIntegrationTypes([
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    ])
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('What she says')
        .setRequired(true)
        .setMaxLength(2000)
    ),

  async execute(interaction) {
    // Ephemeral, so the only thing the channel sees is her saying it.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { client, user, channelId } = interaction;
    if (!(await isBotAdmin(client, user.id))) {
      console.warn(`🚫 ${user.username} (${user.id}) tried to use /echo.`);
      await interaction.editReply(`Nice try, Nine. That one's not for you.`);
      return;
    }

    const message = interaction.options.getString('message');

    try {
      const channel = await client.channels.fetch(channelId);
      // Nobody gets pinged by this, @everyone least of all.
      await channel.send({ content: message, allowedMentions: { parse: [] } });
    } catch (error) {
      console.warn(`⚠️  /echo failed in ${channelId}: ${error.message}`);
      await interaction.editReply(`❌ I can't post here. I'm not in this channel, or I'm not allowed to talk in it.`);
      return;
    }

    // The channel can't tell who made her say it, so this is the only record.
    console.log(`📣 ${user.username} (${user.id}) echoed in ${channelId}: ${message.slice(0, 200)}`);
    await interaction.editReply('✅ Said it.');
  },
};
