import { SlashCommandBuilder, InteractionContextType, ApplicationIntegrationType, MessageFlags } from 'discord.js';
 
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
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The user to DM')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription('The message to send')
        .setRequired(true)
    ),
 
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
 
    const target = interaction.options.getUser('user');
    const message = interaction.options.getString('message');
 
    try {
      await target.send(message);
      await interaction.editReply(`✅ DM sent to ${target.username}`);
    } catch (error) {
      await interaction.editReply(`❌ Could not send DM to ${target.username} — they may have DMs disabled.`);
    }
  },
};