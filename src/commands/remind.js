import {
  SlashCommandBuilder,
  InteractionContextType,
  ApplicationIntegrationType,
  MessageFlags,
} from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Set a reminder (and get scolded when it rings).')
    .setContexts([
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    ])
    .setIntegrationTypes([
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    ])
    .addIntegerOption((option) =>
      option
        .setName('duration')
        .setDescription('Duration in minutes')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(60)
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('What do you want to be reminded of?')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const duration = interaction.options.getInteger('duration');
    const reason = interaction.options.getString('reason');
    const milliseconds = duration * 60 * 1000;

    const registerMumbles = [
      `Fine, I'll keep track of time for ${duration} minutes. Don't make me regret this, Captain.`,
      `Ugh, so I am a stopwatch now? Fine, I'll remind you about "${reason}" in ${duration} minutes. Go do something else.`,
      `Timer set for ${duration} minutes. If you forget it anyway after I remind you, it's not my fault.`,
    ];

    const chosenRegister = registerMumbles[Math.floor(Math.random() * registerMumbles.length)];
    await interaction.editReply(chosenRegister);

    const user = interaction.user;

    setTimeout(async () => {
      const reminderRants = [
        `Oi, Captain ${user}! Get your lazy ass up and do this already: **${reason}**. I had to stare at the clock for ${duration} minutes just for this!`,
        `Hey ${user}! Wake up! You forced me to remind you about: **${reason}**. Don't make me scream next time.`,
        `Mission accomplished. Here is your stupid reminder, ${user}: **${reason}**. Now stop bothering me for a while.`,
      ];

      const finalRant = reminderRants[Math.floor(Math.random() * reminderRants.length)];

      try {
        // Kirim pengingat asli secara publik menggunakan followUp agar user ter-tag nyata
        await interaction.followUp({ content: finalRant });
      } catch (_error) {
        // Jika gagal (misal channel sudah dihapus), abaikan agar bot tidak crash
      }
    }, milliseconds);
  },
};
