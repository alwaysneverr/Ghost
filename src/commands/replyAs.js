import {
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  InteractionContextType,
  ApplicationIntegrationType,
  MessageFlags,
} from 'discord.js';
import { character } from '../character.js';
import { answerInCommand } from '../commandChat.js';
import { cleanName } from '../conversation.js';

const NAME = `Reply as ${character.name}`;
const HER_NAME = new RegExp(`\\b(?:${character.aliases.join('|')})\\b`, 'i');

// Most messages picked for her were said to someone else in the chat; she's butting in.
// It's to her if it @mentions her or uses her name ("ghost, settle this").
function saidToHer(target, botId) {
  return Boolean(target.mentions?.users?.has(botId)) || HER_NAME.test(target.content);
}

export default {
  // Right-click (or long-press) a message, then Apps. She answers that message, as a
  // reply to the command, so it works in group DMs, where she can't read the chat.
  data: new ContextMenuCommandBuilder()
    .setName(NAME)
    .setType(ApplicationCommandType.Message)
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
    const target = interaction.targetMessage;
    const refuse = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

    if (target.author.id === interaction.client.user.id) {
      await refuse(`I'm not answerin' myself, Nine.`);
      return;
    }
    const botId = interaction.client.user.id;
    const content = target.content.replace(new RegExp(`<@!?${botId}>`, 'g'), '').trim();
    if (!content) {
      await refuse(`There's nothin' there I can read, Nine.`);
      return;
    }

    const name = cleanName(
      target.member?.displayName ?? target.author.displayName ?? target.author.username,
      target.author.id
    );
    await answerInCommand(interaction, {
      content,
      speakerId: target.author.id,
      speakerName: name,
      author: name,
      // They didn't say it to her, so nothing about them is kept from it.
      remember: false,
      via: NAME,
      overheard: { toHer: saidToHer(target, botId) },
    });
  },
};
