import {
  SlashCommandBuilder,
  InteractionContextType,
  ApplicationIntegrationType,
  MessageFlags,
} from 'discord.js';
import { cancelReminder, describeMinutes, listReminders } from '../reminders.js';

const MAX_SHOWN_REASON = 80;

// Discord shows <t:…:R> as "in 3 hours" in each person's own time zone.
const when = (dueAt) => `<t:${Math.floor(dueAt / 1000)}:R>`;
const short = (text) =>
  text.length > MAX_SHOWN_REASON ? `${text.slice(0, MAX_SHOWN_REASON - 1)}…` : text;

export default {
  data: new SlashCommandBuilder()
    .setName('reminders')
    .setDescription('See or cancel the reminders you have waiting.')
    .setContexts([
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    ])
    .setIntegrationTypes([
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    ])
    .addSubcommand((subcommand) =>
      subcommand.setName('list').setDescription('Show your reminders. Only you can see it.')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('cancel')
        .setDescription('Cancel one of your reminders.')
        .addIntegerOption((option) =>
          option
            .setName('reminder')
            .setDescription('Which one')
            .setRequired(true)
            .setAutocomplete(true)
        )
    ),

  // Offers their own reminders as they type, so nobody has to remember a number.
  async autocomplete(interaction) {
    const typed = String(interaction.options.getFocused()).toLowerCase();
    const choices = listReminders(interaction.user.id)
      .filter((reminder) => `${reminder.id} ${reminder.reason}`.toLowerCase().includes(typed))
      .slice(0, 25)
      .map((reminder) => ({
        name: short(
          `#${reminder.id}: ${reminder.reason} (${describeMinutes(reminder.minutes)})`
        ).slice(0, 100),
        value: reminder.id,
      }));
    await interaction.respond(choices);
  },

  async execute(interaction) {
    const userId = interaction.user.id;
    // Their own text, shown only to them, but still nobody gets pinged by it.
    const reply = (content) =>
      interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

    if (interaction.options.getSubcommand() === 'cancel') {
      const id = interaction.options.getInteger('reminder');
      await reply(
        cancelReminder(userId, id)
          ? `Fine. Forgot about #${id}. Don't come cryin' when you forget it yourself, Nine.`
          : `You don't have a reminder #${id}, Nine. Check \`/reminders list\`.`
      );
      return;
    }

    const reminders = listReminders(userId);
    if (reminders.length === 0) {
      await reply(`Nothing waiting. Enjoy it while it lasts, Nine.`);
      return;
    }
    await reply(
      `Here's what you've got me watchin' for, Nine:\n${reminders
        .map((reminder) => `\`#${reminder.id}\` ${when(reminder.dueAt)}: ${short(reminder.reason)}`)
        .join('\n')}`
    );
  },
};
