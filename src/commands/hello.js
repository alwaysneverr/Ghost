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
    const isBot = target.id === interaction.client.user.id;

    const greeting = isSelf
      ? `Yo, Captain ${interaction.user}!`
      : isBot 
      ? `Tch, stop making me talk to myself.` 
      : `Oi, Captain ${interaction.user} told me to say hello to you, ${target}. I don't know why he can't say it himself though. Whatevs.`;
 
    await interaction.editReply(greeting);
  },
};