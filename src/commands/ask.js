import {
  SlashCommandBuilder,
  InteractionContextType,
  ApplicationIntegrationType,
} from 'discord.js';
import { answerInCommand } from '../commandChat.js';
import { cleanName } from '../conversation.js';

export default {
  // Chatting by command, for places she can't read: group DMs, and servers she's only
  // in through someone's own install. See commandChat.js.
  data: new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Say something to her. Works in group DMs too.')
    .setContexts([
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    ])
    .setIntegrationTypes([
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    ])
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('What you say to her')
        .setRequired(true)
        .setMaxLength(1500)
    ),

  async execute(interaction) {
    const { user, member } = interaction;
    await answerInCommand(interaction, {
      content: interaction.options.getString('message').trim(),
      speakerId: user.id,
      speakerName: cleanName(member?.displayName ?? user.displayName ?? user.username, user.id),
      remember: true,
      via: '/ask',
    });
  },
};
