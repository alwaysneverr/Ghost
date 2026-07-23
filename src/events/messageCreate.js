import { Events } from 'discord.js';
import { character } from '../character.js';
import { retrieveRelevant } from '../rag.js';
import { logExchange } from '../logger.js';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3:8b';
const RAG_TOP_K = Number(process.env.RAG_TOP_K || 4);

// Keep history short — every extra message adds context the model has to
// reprocess on every reply, which slows generation down.
const MAX_HISTORY = 10;

// channelId -> [{ role, content }]. In-memory only; resets on bot restart.
const conversationHistory = new Map();

// Quick canned lines for a bare/empty ping — no real message to respond to,
// so skip the LLM entirely and just stay in character.
const pingRants = [
  `Unless the server is literally on fire, don't you dare ping me, {user}.`,
  `Tch, another ghost ping? You guys really love testing my patience. What do you want, Captain?`,
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
    while (history.length > MAX_HISTORY) history.shift();

    try {
      await message.channel.sendTyping();

      // Pull relevant script moments grounded on what the user just said
      let referenceBlock = '';
      try {
        const relevant = await retrieveRelevant(content, RAG_TOP_K);
        if (relevant.length > 0) {
          referenceBlock = `\n\nReference moments from the script that may be relevant here:\n\n${relevant
            .map(r => `--- ${r.file} (lines ${r.lineStart}-${r.lineEnd}) ---\n${r.text}`)
            .join('\n\n')}`;
        }
      } catch (ragError) {
        console.warn('⚠️  RAG retrieval failed, continuing without it:', ragError.message);
      }

      const systemPrompt = character.systemPrompt + referenceBlock;

      const response = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages: [{ role: 'system', content: systemPrompt }, ...history],
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama returned HTTP ${response.status}`);
      }

      const data = await response.json();
      const reply = data.message?.content?.trim();

      if (!reply) throw new Error('Empty response from Ollama');

      history.push({ role: 'assistant', content: reply });
      while (history.length > MAX_HISTORY) history.shift();
      conversationHistory.set(channelId, history);

      // Discord caps messages at 2000 characters
      const sent = await message.reply(reply.slice(0, 2000));

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