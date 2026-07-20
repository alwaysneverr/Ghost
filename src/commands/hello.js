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
        .setDescription('The user to greet (works in servers)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('target')
        .setDescription('Who to greet in DMs')
        .setRequired(false)
        .addChoices(
          { name: 'Me', value: 'me' },
          { name: 'Bot', value: 'bot' },
        )
    ),
 
  async execute(interaction) {
    await interaction.deferReply();
 
    const botUser = interaction.client.user;
    const userOption = interaction.options.getUser('user');
    const targetOption = interaction.options.getString('target');
 
    // Resolve the target: string choice takes priority in DM context
    let target;
    if (targetOption === 'bot') {
      target = botUser;
    } else if (targetOption === 'me' || (!userOption && !targetOption)) {
      target = interaction.user;
    } else {
      target = userOption;
    }
 
   const greeting = isSelf
      ? `Yo, Captain ${interaction.user}!`
      : isBot 
      ? `Tch, stop making me talk to myself.` 
      : `Oi, Captain ${interaction.user} told me to say hello to you, ${target}. I don't know why he can't say it himself though. Whatevs.`;
 
    await interaction.editReply(greeting);
  },
};