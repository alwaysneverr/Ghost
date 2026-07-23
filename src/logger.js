/**
 * Logs conversation exchanges and 👍/👎 ratings to a JSONL file for later
 * curation into fine-tuning data (see scripts/export-training-data.js).
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, '..', 'data', 'logs');
const LOG_PATH = join(LOG_DIR, 'conversations.jsonl');

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