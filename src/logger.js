/**
 * Logs conversation exchanges and 👍/👎 ratings to a JSONL file for later
 * curation into fine-tuning data (see scripts/export-training-data.js), and
 * everything people send her to a separate one, for keeping an eye on the bot.
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MessageFlags } from 'discord.js';
import { needsGentleReply } from './safety.js';
import { getChannel } from './store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, '..', 'data', 'logs');
const LOG_PATH = join(LOG_DIR, 'conversations.jsonl');
const MESSAGE_LOG_PATH = join(LOG_DIR, 'messages.jsonl');

const MAX_CONSOLE_TEXT = 200;

function ensureLogDir() {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
}

// messageId is the bot's reply message ID — used later to attach a rating
// if someone reacts to it.
export function logExchange({ messageId, channelId, userId, userMessage, botReply }) {
  ensureLogDir();
  appendFileSync(LOG_PATH, JSON.stringify({
    type: 'exchange',
    timestamp: new Date().toISOString(),
    messageId,
    channelId,
    userId,
    userMessage,
    botReply,
  }) + '\n');
}

// One row in messages.jsonl and one line in the console. withheld records that
// someone's worst day happened but not their words: history only keeps those for 24
// hours on purpose (store.js), and this file keeps everything until it's deleted.
function writeMessage(message, content, withheld, { direction, icon, label, extra = {} }) {
  ensureLogDir();
  const attachments = withheld
    ? []
    : [...message.attachments.values()].map(({ name, url }) => ({ name, url }));
  appendFileSync(MESSAGE_LOG_PATH, JSON.stringify({
    type: 'message',
    direction,
    timestamp: new Date().toISOString(),
    messageId: message.id,
    userId: message.author.id,
    username: message.author.username,
    guildId: message.guildId,
    guildName: message.guild?.name ?? null,
    channelId: message.channel.id,
    ...extra,
    content: withheld ? null : content,
    attachments,
    withheld,
  }) + '\n');

  const shown = withheld
    ? '(withheld: grief or crisis)'
    : `${content.slice(0, MAX_CONSOLE_TEXT) || '(no text)'}${attachments.length > 0 ? ` [+${attachments.length} attachment(s)]` : ''}`;
  const where = message.guild?.name ?? message.guildId ?? 'DM';
  // People control this text, so it stays on one line with no control characters.
  console.log(`${icon} [${where}] ${label}: ${shown}`.replace(/[\s\p{Cc}]+/gu, ' '));
}

// One message sent to her, whether or not she goes on to answer it. Apart from
// conversations.jsonl, because that one becomes training data.
// A failure here warns and carries on, since a full disk shouldn't stop her replying.
export function logMessage(message, content, withheld) {
  try {
    writeMessage(message, content, withheld, {
      direction: 'received',
      icon: '📨',
      label: `${message.author.username} (${message.author.id})`,
    });
  } catch (error) {
    console.warn('⚠️  Could not log an incoming message:', error.message);
  }
}

// Her "thinking…" placeholders from deferReply. They arrive empty and get their text in
// an edit, so they're logged then (see messageUpdate.js). Kept small: an edit comes
// within 15 minutes or never.
const awaitingText = new Set();
const MAX_AWAITING = 100;

// True once, for a placeholder that's just been filled in.
export function isAwaitingText(messageId) {
  return awaitingText.delete(messageId);
}

// One message she sent: a chat reply, /dm, /echo, /tell, a reminder, anything. Discord
// tells the bot about its own messages, so they're all caught in one place. Withheld,
// like theirs, when someone in that channel is grieving or in crisis.
// In a DM she sent herself, recipientId is who it went to. A reply to a command has
// commandUserId instead: it went wherever the command was used, which can be a DM
// between other people, and labelling that "to" whoever else is in it read as though
// she'd DM'd them.
export function logSent(message) {
  try {
    if (message.flags?.has(MessageFlags.Loading)) {
      awaitingText.add(message.id);
      if (awaitingText.size > MAX_AWAITING) awaitingText.delete(awaitingText.values().next().value);
      return;
    }

    const theirs = getChannel(message.channel.id).history.filter(m => m.role === 'user').map(m => m.content);
    const command = message.interactionMetadata;
    const recipientId = !command && message.channel.isDMBased?.() ? message.channel.recipientId : null;
    const to = recipientId && recipientId !== message.author.id ? recipientId : null;
    const toName = to ? (message.client.users.cache.get(to)?.username ?? null) : null;
    const commandName = message.interaction?.commandName;
    const label = command
      ? `reply to ${command.user.username}'s ${commandName ? `/${commandName}` : 'command'}`
      : to
        ? `to ${toName ?? 'someone'} (${to})`
        : `in ${message.channel.id}`;

    writeMessage(message, message.content, needsGentleReply(theirs), {
      direction: 'sent',
      icon: '📤',
      label,
      extra: {
        recipientId: to,
        recipientName: toName,
        commandUserId: command?.user.id ?? null,
        command: commandName ?? null,
      },
    });
  } catch (error) {
    console.warn('⚠️  Could not log a message she sent:', error.message);
  }
}

export function logRating({ messageId, rating, raterId }) {
  ensureLogDir();
  appendFileSync(LOG_PATH, JSON.stringify({
    type: 'rating',
    timestamp: new Date().toISOString(),
    messageId,
    rating, // 'up' | 'down'
    raterId,
  }) + '\n');
}