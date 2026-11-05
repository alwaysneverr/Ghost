/**
 * Chatting with her through a command instead of a message: /ask, and the "Reply as"
 * message command. These work where she can't read the channel, like group DMs and
 * servers she's only in through someone's own install, because the reply goes back as
 * the command's response. She only knows what reaches her through these, not the rest
 * of the conversation around them.
 */

import { InteractionContextType, MessageFlags } from 'discord.js';
import { character } from './character.js';
import { converse, isSensitive } from './conversation.js';
import { ollamaAnswered, ollamaFailed } from './health.js';
import { logExchange, logMessage } from './logger.js';
import { rememberFrom } from './memory.js';
import { OllamaError } from './ollama.js';
import { ratingButtons } from './rating.js';

const QUOTE_LENGTH = 200;

// Where what she remembers belongs: a server, her own DMs, or this one group DM. A group
// DM gets its own, because everyone in it can read her replies, and facts from her
// private DMs mustn't turn up in front of them.
export function memoryScope(interaction) {
  if (interaction.guildId) return interaction.guildId;
  return interaction.context === InteractionContextType.PrivateChannel
    ? `group:${interaction.channelId}`
    : 'dm';
}

// Nobody else can see what was asked, only her answer, so it's quoted above the reply.
function quote(content, author = null) {
  const flat = content.replace(/\s+/g, ' ').trim();
  const shown = flat.length > QUOTE_LENGTH ? `${flat.slice(0, QUOTE_LENGTH - 1)}…` : flat;
  return `> ${author ? `**${author}:** ` : ''}${shown}`;
}

// speaker is who she's answering: whoever used /ask, or whoever wrote the message.
// remember is whether facts may be kept from it, so never from someone else's message.
// Grief and crisis get a reply only the person using the command sees, with nothing
// quoted, so their worst day isn't put in front of a group chat.
export async function answerInCommand(
  interaction,
  { content, speakerId, speakerName, author = null, remember, via }
) {
  const channelId = interaction.channelId;
  const sensitive = isSensitive(channelId, content);
  await interaction.deferReply(sensitive ? { flags: MessageFlags.Ephemeral } : {});

  logMessage(
    {
      id: interaction.id,
      author: interaction.user,
      guildId: interaction.guildId,
      guild: interaction.guild,
      channel: { id: channelId },
      attachments: new Map(),
    },
    content,
    sensitive,
    { via }
  );

  const scope = memoryScope(interaction);
  try {
    const { reply, rateable } = await converse({
      channelId,
      speakerId,
      speakerName,
      content,
      scope,
    });
    ollamaAnswered(interaction.client);
    const sent = await interaction.editReply({
      content: (sensitive ? reply : `${quote(content, author)}\n${reply}`).slice(0, 2000),
      components: rateable ? [ratingButtons()] : [],
      // People wrote the quote, and nobody asked to be pinged by her reply.
      allowedMentions: { parse: [] },
    });
    if (!rateable) return;

    logExchange({
      messageId: sent.id,
      channelId,
      userId: speakerId,
      userMessage: content,
      botReply: reply,
    });
    if (remember) rememberFrom(speakerId, scope, content);
  } catch (error) {
    console.error(`❌ Chat error in ${via}:`, error);
    if (error instanceof OllamaError) ollamaFailed(interaction.client, error);
    await interaction.editReply(character.offlineReply);
  }
}
