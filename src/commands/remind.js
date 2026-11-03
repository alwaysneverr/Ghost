import {
  SlashCommandBuilder,
  InteractionContextType,
  ApplicationIntegrationType,
  MessageFlags,
} from 'discord.js';
import { createReminder } from '../reminders.js';

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
        .setMaxLength(1000)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const duration = interaction.options.getInteger('duration');
    const reason = interaction.options.getString('reason');

    const created = createReminder(interaction.client, {
      userId: interaction.user.id,
      channelId: interaction.channelId,
      reason,
      minutes: duration,
    });
    if (!created) {
      await interaction.editReply(`You've already got a pile of these waiting, Captain. Do some of them first.`);
      return;
    }

    const registerMumbles = [
      `Fine, I'll keep track of time for ${duration} minutes. Don't make me regret this, Captain.`,
      `Ugh, so I am a stopwatch now? Fine, I'll remind you about "${reason}" in ${duration} minutes. Go do something else.`,
      `Timer set for ${duration} minutes. If you forget it anyway after I remind you, it's not my fault.`,
    ];

    const chosenRegister = registerMumbles[Math.floor(Math.random() * registerMumbles.length)];
    await interaction.editReply(chosenRegister);
  },
};
