import { Events } from 'discord.js';
import { character } from '../character.js';
import { buildSystemPrompt } from '../rag.js';
import { chatFresh } from '../llm.js';
import { logExchange } from '../logger.js';
import { isCrisis, inCrisis, needsGentleReply } from '../safety.js';

const RAG_TOP_K = Number(process.env.RAG_TOP_K || 4);

// Every extra message adds context the model has to reprocess on every reply.
// 20 adds well under a second at the ~1,700 tokens/s measured on an RTX 3060.
const MAX_HISTORY = 20;

// channelId -> [{ role, content }]. In-memory only; resets on bot restart.
const conversationHistory = new Map();

// channelId -> her replies, reaching further back than the history the model
// sees, so she can't repeat something once it has scrolled out of that.
const pastReplies = new Map();
const MAX_PAST_REPLIES = 50;

// History must never open on one of her replies: when it did, the model repeated
// that reply, so from the point history filled up she replayed the conversation.
function trimHistory(history) {
  while (history.length > MAX_HISTORY) history.shift();
  while (history[0]?.role === 'assistant') history.shift();
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

    if (message.author.bot || message.webhookId || message.author.id === client.user.id) return;

    const isDM = message.channel.isDMBased?.() ?? false;
    const isMentioned = message.mentions.has(client.user) && !message.mentions.everyone;

    // Only respond in DMs, or when directly @mentioned in a server.
    if (!isDM && !isMentioned) return;

    const content = message.content
      .replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '')
      .trim();

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

    const channelId = message.channel.id;
    const history = conversationHistory.get(channelId) ?? [];

    history.push({ role: 'user', content });
    trimHistory(history);

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
        const { prompt, factual } = await buildSystemPrompt(content, RAG_TOP_K, userMessages);
        const past = pastReplies.get(channelId) ?? [];
        reply = await chatFresh([{ role: 'system', content: prompt }, ...history], {
          pastReplies: past,
          factual,
        });
        if (!needsGentleReply(userMessages)) reply = maybeAddName(reply);
        pastReplies.set(channelId, [...past, reply].slice(-MAX_PAST_REPLIES));
      }

      history.push({ role: 'assistant', content: reply });
      trimHistory(history);
      conversationHistory.set(channelId, history);

      // Discord caps messages at 2000 characters
      const sent = await message.reply(reply.slice(0, 2000));

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
    } catch (error) {
      console.error('❌ Chat error:', error);
      try {
        await message.reply(`❌ ${character.name} isn't responding — check that Ollama is running and reachable on the workstation.`);
      } catch (_error) {
        // e.g. channel deleted mid-flight — ignore
      }
    }
  },
};