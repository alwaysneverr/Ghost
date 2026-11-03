import { Events } from 'discord.js';
import { character } from '../character.js';
import { buildSystemPrompt } from '../rag.js';
import { chatFresh, recentStart } from '../llm.js';
import { logExchange, logMessage, logSent } from '../logger.js';
import { isCrisis, inCrisis, needsGentleReply } from '../safety.js';
import { getChannel, getFacts, saveChannel } from '../store.js';
import { MEMORY_ENABLED, rememberFrom } from '../memory.js';
import { createStreamer } from '../streamReply.js';

const RAG_TOP_K = Number(process.env.RAG_TOP_K || 4);

// Off by default: replies are short enough to finish in about a second, and live
// text can show a repeat before chatFresh gets the chance to replace it.
const STREAM_REPLIES = process.env.STREAM_REPLIES === 'true';

// Every extra message adds context the model has to reprocess on every reply.
// 20 adds well under a second at the ~1,700 tokens/s measured on an RTX 3060.
const MAX_HISTORY = 20;

// Her replies reach further back than the history the model sees, so she can't
// repeat something once it has scrolled out of that.
const MAX_PAST_REPLIES = 50;

// How many things she remembers about someone go into the prompt at once.
const MAX_REMEMBERED = 5;

const MAX_SPEAKER_NAME = 32;

// How many earlier messages get listed by name in a group conversation.
const MAX_GROUP_LINES = 6;

// History must never open on one of her replies: when it did, the model repeated
// that reply, so from the point history filled up she replayed the conversation.
function trimHistory(history) {
  while (history.length > MAX_HISTORY) history.shift();
  while (history[0]?.role === 'assistant') history.shift();
}

// Display names are whatever people type, and they go into the prompt, so only
// letters, numbers and spaces survive. That keeps out "SYSTEM:" and line breaks.
function speakerName(message) {
  const raw = message.member?.displayName ?? message.author.displayName ?? message.author.username ?? '';
  const name = raw
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SPEAKER_NAME);
  return name || `Person ${message.author.id.slice(-4)}`;
}

// What the model sees. The history itself keeps their exact words, which is what
// the safety checks and retrieval read. Names only appear once there's more than
// one person: a DM stays a plain conversation.
function toModelMessages(history) {
  const speakers = new Set(history.map(m => m.speakerId).filter(Boolean));
  return history.map(({ role, content, speaker }) => ({
    role,
    content: speakers.size > 1 && speaker ? `${speaker}: ${content}` : content,
  }));
}

// Now and then, works their name into the end of the reply: "What's your deal?"
// becomes "What's your deal, Nine?" Done here, not by the model; see nameChance.
function maybeAddName(reply) {
  if (Math.random() >= character.nameChance || /\bnine\b/i.test(reply)) return reply;
  return reply.replace(/([.!?…]+["”']?)\s*$/, ', Nine$1');
}

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

    const content = message.content
      .replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '')
      .trim();

    const channelId = message.channel.id;
    const channel = getChannel(channelId);
    const { history } = channel;

    // Only what's sent to her: the bot can see every message in a server it's in, and
    // those are none of its business.
    const earlierMessages = history.filter(m => m.role === 'user').map(m => m.content);
    logMessage(message, content, needsGentleReply([...earlierMessages, content]));

    // Bare/empty ping — no actual message, just a quick in-character rant
    if (isMentioned && !content) {
      const chosenRant = pingRants[Math.floor(Math.random() * pingRants.length)]
        .replace('{user}', message.author.toString());

      try {
        await message.reply(chosenRant);
      } catch (_error) {
        // e.g. channel deleted mid-flight — ignore
      }
      return;
    }

    if (!content) return; // empty DM (attachment only, etc.) — nothing to respond to

    const scope = message.guildId ?? 'dm';

    const speaker = speakerName(message);
    const theirMessage = { role: 'user', content, speaker, speakerId: message.author.id };
    history.push(theirMessage);
    trimHistory(history);

    let streamer = null;
    try {
      await message.channel.sendTyping();

      let userMessages = history.filter(m => m.role === 'user').map(m => m.content);

      // A crisis has just scrolled out of history. Start fresh, or the model
      // sees a conversation full of the fixed text and starts copying it.
      if (!inCrisis(userMessages) && history.some(m => m.content === character.crisisFollowUp)) {
        history.splice(0, history.length - 1);
        userMessages = [content];
      }

      // Someone in crisis always gets fixed text: nothing the model writes can
      // be trusted here. Otherwise, pull relevant script moments grounded on
      // what the user just said (unless they're hurting; see rag.js).
      let reply;
      if (inCrisis(userMessages)) {
        reply = isCrisis(content) ? character.crisisReply : character.crisisFollowUp;
      } else {
        const remembered = MEMORY_ENABLED ? getFacts(message.author.id, scope, MAX_REMEMBERED) : [];
        const modelMessages = toModelMessages(history);
        const isGroup = modelMessages.some((m, i) => m.content !== history[i].content);
        // Someone hurting gets a prompt with no room for anything else, so they keep
        // the whole conversation.
        const gentle = needsGentleReply(userMessages);
        const start = gentle ? 0 : recentStart(history);
        const earlier = history.slice(0, start).filter(m => m.role === 'user').map(m => m.content);
        const { prompt, factual, scripted } = await buildSystemPrompt(
          content,
          RAG_TOP_K,
          userMessages,
          remembered,
          isGroup
            ? {
                speaker,
                recent: history.filter(m => m.role === 'user' && m !== theirMessage).slice(-MAX_GROUP_LINES),
              }
            : null,
          isGroup ? [] : earlier
        );
        // Nothing half-written on someone's worst day.
        if (STREAM_REPLIES && !gentle) streamer = createStreamer(message);
        reply = await chatFresh([{ role: 'system', content: prompt }, ...modelMessages.slice(start)], {
          pastReplies: channel.pastReplies,
          factual,
          scripted,
          gentle,
          onToken: streamer?.update,
        });
        if (!gentle) reply = maybeAddName(reply);
        channel.pastReplies = [...channel.pastReplies, reply].slice(-MAX_PAST_REPLIES);
      }

      history.push({ role: 'assistant', content: reply });
      trimHistory(history);
      saveChannel(channelId);

      // Discord caps messages at 2000 characters
      const sent = streamer ? await streamer.finish(reply) : await message.reply(reply.slice(0, 2000));

      // No rating buttons on someone's worst day, and it stays out of the logs
      // that become training data.
      if (needsGentleReply(userMessages)) return;

      logExchange({
        messageId: sent.id,
        channelId: message.channel.id,
        userId: message.author.id,
        userMessage: content,
        botReply: reply,
      });

      // Let people mark good/bad replies for later fine-tuning curation
      sent.react('👍').catch(() => {});
      sent.react('👎').catch(() => {});

      rememberFrom(message.author.id, scope, content);
    } catch (error) {
      // She never answered it, so it mustn't sit in history as an unanswered message.
      const unanswered = history.lastIndexOf(theirMessage);
      if (unanswered >= 0 && history[unanswered + 1]?.role !== 'assistant') history.splice(unanswered, 1);
      await streamer?.abort();

      console.error('❌ Chat error:', error);
      try {
        await message.reply(`❌ ${character.name} isn't responding — check that Ollama is running and reachable on the workstation.`);
      } catch (_error) {
        // e.g. channel deleted mid-flight — ignore
      }
    }
  },
};