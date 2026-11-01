/**
 * Logs conversation exchanges and 👍/👎 ratings to a JSONL file for later
 * curation into fine-tuning data (see scripts/export-training-data.js), and
 * everything people send her to a separate one, for keeping an eye on the bot.
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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

// One message sent to her, whether or not she goes on to answer it. Apart from
// conversations.jsonl, because that one becomes training data. withheld records that
// someone's worst day happened but not their words: history only keeps those for 24
// hours on purpose (store.js), and this file keeps everything until it's deleted.
// A failure here warns and carries on, since a full disk shouldn't stop her replying.
export function logMessage(message, content, withheld) {
  try {
    ensureLogDir();
    const attachments = withheld
      ? []
      : [...message.attachments.values()].map(({ name, url }) => ({ name, url }));
    appendFileSync(MESSAGE_LOG_PATH, JSON.stringify({
      type: 'message',
      timestamp: new Date().toISOString(),
      messageId: message.id,
      userId: message.author.id,
      username: message.author.username,
      guildId: message.guildId,
      guildName: message.guild?.name ?? null,
      channelId: message.channel.id,
      content: withheld ? null : content,
      attachments,
      withheld,
    }) + '\n');

    const shown = withheld
      ? '(withheld: grief or crisis)'
      : `${content.slice(0, MAX_CONSOLE_TEXT) || '(no text)'}${attachments.length > 0 ? ` [+${attachments.length} attachment(s)]` : ''}`;
    const where = message.guild?.name ?? message.guildId ?? 'DM';
    // People control this text, so it stays on one line with no control characters.
    console.log(`📨 [${where}] ${message.author.username} (${message.author.id}): ${shown}`.replace(/[\s\p{Cc}]+/gu, ' '));
  } catch (error) {
    console.warn('⚠️  Could not log an incoming message:', error.message);
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