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

const CONTEXT_MESSAGES = 8;
const CONTEXT_CHARS = 300;

function nameOf(message) {
  return cleanName(
    message.member?.displayName ?? message.author.displayName ?? message.author.username,
    message.author.id
  );
}

// What a message says, as one line. Her own answers to commands start with the message
// they quoted ("> **Ana:** …"), which isn't something she said.
function lineOf(message, botId) {
  const hers = message.author.id === botId;
  let text = message.content.replace(new RegExp(`<@!?${botId}>`, 'g'), '');
  if (hers) text = text.replace(/^>.*\n?/, '');
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length > CONTEXT_CHARS) text = `${text.slice(0, CONTEXT_CHARS - 1)}…`;
  return { speaker: hers ? character.name : nameOf(message), content: text, hers };
}

// The conversation the message was part of: the messages just before it, and the one it
// replies to. Only where she can read the channel; in group DMs and through someone's own
// install, Discord hands over the one message and nothing else, so this comes back empty.
async function chatAround(interaction, target, botId) {
  let repliedTo = null;
  if (target.reference?.messageId) {
    try {
      repliedTo = lineOf(await target.fetchReference(), botId);
    } catch {
      // Deleted, or a channel she can't read.
    }
  }
  let lines = [];
  try {
    const before = await interaction.channel?.messages.fetch({
      before: target.id,
      limit: CONTEXT_MESSAGES,
    });
    lines = [...(before?.values() ?? [])]
      .reverse() // Discord sends the newest first
      .filter((m) => !m.system)
      .map((m) => lineOf(m, botId))
      .filter((line) => line.content);
  } catch {
    // No permission to read the history here.
  }
  return { lines, repliedTo: repliedTo?.content ? repliedTo : null };
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

    const name = nameOf(target);
    await answerInCommand(interaction, {
      content,
      speakerId: target.author.id,
      speakerName: name,
      author: name,
      // They didn't say it to her, so nothing about them is kept from it.
      remember: false,
      via: NAME,
      // A function, so the fetching happens after the reply is deferred: Discord allows
      // 3 seconds before that.
      overheard: async () => {
        const { lines, repliedTo } = await chatAround(interaction, target, botId);
        return {
          speaker: name,
          lines,
          repliedTo,
          toHer: saidToHer(target, botId) || Boolean(repliedTo?.hers),
        };
      },
    });
  },
};
