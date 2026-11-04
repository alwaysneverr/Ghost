import {
  SlashCommandBuilder,
  InteractionContextType,
  ApplicationIntegrationType,
  MessageFlags,
} from 'discord.js';
import { forgetFacts, getAllFacts } from '../store.js';

const MAX_MESSAGE_LENGTH = 2000;

function describe(rows) {
  const lines = rows.map(({ scope, fact }) => `- ${fact}${scope === 'dm' ? ' *(from DMs)*' : ''}`);
  return `Here's what I've got on you. It stays where you said it, and \`/memory forget\` wipes it:\n${lines.join('\n')}`.slice(
    0,
    MAX_MESSAGE_LENGTH
  );
}

export default {
  data: new SlashCommandBuilder()
    .setName('memory')
    .setDescription('See or wipe what she remembers about you.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('show')
        .setDescription('Show what she remembers about you. Only you can see it.')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('forget')
        .setDescription('Delete everything she remembers about you, everywhere.')
    )
    .setContexts([
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    ])
    .setIntegrationTypes([
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    ]),

  async execute(interaction) {
    const userId = interaction.user.id;

    if (interaction.options.getSubcommand() === 'forget') {
      const count = forgetFacts(userId);
      await interaction.reply({
        content:
          count > 0
            ? `Done. ${count} thing(s) gone. Never heard of you.`
            : `I've got nothing on you anyway.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const rows = getAllFacts(userId);
    await interaction.reply({
      content: rows.length > 0 ? describe(rows) : `I've got nothing on you.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
