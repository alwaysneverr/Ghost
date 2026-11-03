import {
  SlashCommandBuilder,
  InteractionContextType,
  ApplicationIntegrationType,
} from 'discord.js';

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
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('The user to greet (works in servers)')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('target')
        .setDescription('Who to greet in DMs')
        .setRequired(false)
        .addChoices({ name: 'Me', value: 'me' }, { name: 'Bot', value: 'bot' })
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const botUser = interaction.client.user;
    const userOption = interaction.options.getUser('user');
    const targetOption = interaction.options.getString('target');

    let target;
    if (targetOption === 'bot') {
      target = botUser;
    } else if (targetOption === 'me' || (!userOption && !targetOption)) {
      target = interaction.user;
    } else {
      target = userOption;
    }

    const isSelf = target.id === interaction.user.id;
    const isBot = target.id === botUser.id;

    const randomGreetings = [
      `Oi, Nine ${interaction.user} told me to say hello to you, ${target}. I don't know why they can't say it themselves though. Whatevs.`,
      `Hey ${target}, Nine ${interaction.user} sent me to look for you. Consider yourself greeted. Now leave me alone.`,
      `Ugh, Nine ${interaction.user} is being lazy again and forced me to say hi to you, ${target}. Don't get any ideas, alright?`,
      `Look, ${target}, I'm just here because Nine ${interaction.user} told me to. Hi. There, mission accomplished.`,
    ];

    const randomIndex = Math.floor(Math.random() * randomGreetings.length);
    const chosenGreeting = randomGreetings[randomIndex];

    const greeting = isSelf
      ? `Yo, Nine ${interaction.user}!`
      : isBot
        ? `Tch, stop making me talk to myself.`
        : chosenGreeting;

    await interaction.editReply(greeting);
  },
};
