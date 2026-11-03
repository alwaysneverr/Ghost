import {
  SlashCommandBuilder,
  InteractionContextType,
  ApplicationIntegrationType,
  MessageFlags,
} from 'discord.js';
import { createReminder, describeMinutes, MAX_REMINDER_MINUTES } from '../reminders.js';

const MINUTES_PER = { minutes: 1, hours: 60, days: 24 * 60 };

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
        .setDescription('How long from now, in minutes unless you pick a unit')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(MAX_REMINDER_MINUTES)
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('What do you want to be reminded of?')
        .setRequired(true)
        .setMaxLength(1000)
    )
    .addStringOption((option) =>
      option
        .setName('unit')
        .setDescription('Minutes, hours or days (minutes if you leave it out)')
        .setRequired(false)
        .addChoices(
          { name: 'minutes', value: 'minutes' },
          { name: 'hours', value: 'hours' },
          { name: 'days', value: 'days' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const unit = interaction.options.getString('unit') ?? 'minutes';
    const minutes = interaction.options.getInteger('duration') * MINUTES_PER[unit];
    const reason = interaction.options.getString('reason');

    if (minutes > MAX_REMINDER_MINUTES) {
      await interaction.editReply(`A month, tops, Nine. I'm not keepin' track of your life for longer than that.`);
      return;
    }

    const created = createReminder(interaction.client, {
      userId: interaction.user.id,
      channelId: interaction.channelId,
      reason,
      minutes,
    });
    if (!created) {
      await interaction.editReply(`You've already got a pile of these waiting, Nine. Do some of them first.`);
      return;
    }

    const duration = describeMinutes(minutes);
    const registerMumbles = [
      `Fine, I'll keep track of time for ${duration}. Don't make me regret this, Nine.`,
      `Ugh, so I am a stopwatch now? Fine, I'll remind you about "${reason}" in ${duration}. Go do something else.`,
      `Timer set for ${duration}. If you forget it anyway after I remind you, it's not my fault.`,
    ];

    const chosenRegister = registerMumbles[Math.floor(Math.random() * registerMumbles.length)];
    await interaction.editReply(chosenRegister);
  },
};
