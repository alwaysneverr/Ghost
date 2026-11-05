import { Events } from 'discord.js';
import { character } from '../character.js';
import { cleanName, converse, isSensitive } from '../conversation.js';
import { ollamaAnswered, ollamaFailed } from '../health.js';
import { logExchange, logMessage, logSent } from '../logger.js';
import { rememberFrom } from '../memory.js';
import { OllamaError } from '../ollama.js';
import { ratingButtons } from '../rating.js';
import { createStreamer } from '../streamReply.js';

const TYPING_EVERY_MS = 8000;

// Off by default: replies are short enough to finish in about a second, and live
// text can show a repeat before chatFresh gets the chance to replace it.
const STREAM_REPLIES = process.env.STREAM_REPLIES === 'true';

// Quick canned lines for a bare/empty ping — no real message to respond to,
// so skip the LLM entirely and just stay in character.
const pingRants = [
  `Unless the server is literally on fire, don't you dare ping me, {user}.`,
  `Tch, another ghost ping? You guys really love testing my patience. What do you want, Nine?`,
  `Stop pinging me. Go ask Sophitia or someone else. I'm off duty.`,
  `Do I look like a customer service bot to you, {user}? Use a slash command if you want something.`,
];

export default {
  name: Events.MessageCreate,
  once: false,

  async execute(message) {
    const client = message.client;

    // Her own messages go to the same log as theirs.
    if (message.author.id === client.user.id) {
      logSent(message);
      return;
    }

    if (message.author.bot || message.webhookId) return;

    const isDM = message.channel.isDMBased?.() ?? false;
    const isMentioned = message.mentions.has(client.user) && !message.mentions.everyone;

    // Only respond in DMs, or when directly @mentioned in a server.
    if (!isDM && !isMentioned) return;

    const content = message.content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();

    const channelId = message.channel.id;

    // Only what's sent to her: the bot can see every message in a server it's in, and
    // those are none of its business.
    logMessage(message, content, isSensitive(channelId, content));

    // Bare/empty ping — no actual message, just a quick in-character rant
    if (isMentioned && !content) {
      const chosenRant = pingRants[Math.floor(Math.random() * pingRants.length)].replace(
        '{user}',
        message.author.toString()
      );

      try {
        await message.reply(chosenRant);
      } catch (_error) {
        // e.g. channel deleted mid-flight — ignore
      }
      return;
    }

    if (!content) return; // empty DM (attachment only, etc.) — nothing to respond to

    const scope = message.guildId ?? 'dm';
    let streamer = null;
    // "Typing…" lasts 10 seconds; a slow reply (a model still loading, retries, a queue
    // behind other messages) needs it sent again until there's something to show.
    const typing = setInterval(() => message.channel.sendTyping().catch(() => {}), TYPING_EVERY_MS);
    try {
      await message.channel.sendTyping();

      const { reply, rateable } = await converse({
        channelId,
        speakerId: message.author.id,
        speakerName: cleanName(
          message.member?.displayName ?? message.author.displayName ?? message.author.username,
          message.author.id
        ),
        content,
        scope,
        startStream: STREAM_REPLIES
          ? () => {
              clearInterval(typing);
              return (streamer = createStreamer(message));
            }
          : null,
      });
      clearInterval(typing);
      ollamaAnswered(client);

      // Discord caps messages at 2000 characters. No rating buttons on someone's
      // worst day, and it stays out of the logs that become training data.
      const components = rateable ? [ratingButtons()] : [];
      let sent;
      if (streamer) {
        sent = await streamer.finish(reply);
        if (rateable) await sent.edit({ components }).catch(() => {});
      } else {
        sent = await message.reply({ content: reply.slice(0, 2000), components });
      }
      if (!rateable) return;

      logExchange({
        messageId: sent.id,
        channelId,
        userId: message.author.id,
        userMessage: content,
        botReply: reply,
      });

      rememberFrom(message.author.id, scope, content);
    } catch (error) {
      clearInterval(typing);
      await streamer?.abort();

      console.error('❌ Chat error:', error);
      if (error instanceof OllamaError) ollamaFailed(client, error);
      try {
        await message.reply(character.offlineReply);
      } catch (_error) {
        // e.g. channel deleted mid-flight — ignore
      }
    }
  },
};
