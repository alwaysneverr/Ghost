import { SlashCommandBuilder, InteractionContextType, ApplicationIntegrationType } from 'discord.js';
 
export default {
  data: new SlashCommandBuilder()
    .setName('hello')
    .setDescription('Greets a user.')
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
        .setDescription('The user to greet (defaults to you)')
        .setRequired(false)
    ),
 
  async execute(interaction) {
    await interaction.deferReply();
 
    const target = interaction.options.getUser('user') ?? interaction.user;
    const isSelf = target.id === interaction.user.id;
    const greeting = isSelf
      ? `👋 Hey there, ${target}!`
      : `👋 ${interaction.user} says hello to ${target}!`;
 
    await interaction.editReply(greeting);
  },
};