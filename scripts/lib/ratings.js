/**
 * Reads logged exchanges and 👍/👎 ratings from the conversation log. Used by
 * export-training-data.js and export-preference-data.js, so both agree on which
 * replies count as good.
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = join(__dirname, '..', '..', 'data', 'logs', 'conversations.jsonl');

// Returns every logged exchange with `score`: 👍s minus 👎s, counting only each
// rater's latest vote, so one late 👎 can't erase several 👍s. Never-rated
// exchanges score 0, as do ties, so `rated` tells the two apart.
export function loadRatedExchanges() {
  if (!existsSync(LOG_PATH)) {
    console.error(`❌ No log file found at ${LOG_PATH}`);
    process.exit(1);
  }

  const exchanges = new Map(); // messageId -> exchange
  const votes = new Map(); // messageId -> Map(raterId -> 'up' | 'down')

  for (const line of readFileSync(LOG_PATH, 'utf-8').split('\n').filter(Boolean)) {
    const entry = JSON.parse(line);
    if (entry.type === 'exchange') {
      exchanges.set(entry.messageId, entry);
    } else if (entry.type === 'rating') {
      if (!votes.has(entry.messageId)) votes.set(entry.messageId, new Map());
      votes.get(entry.messageId).set(entry.raterId, entry.rating);
    }
  }

  return [...exchanges.values()].map(exchange => {
    const cast = [...(votes.get(exchange.messageId)?.values() ?? [])];
    const up = cast.filter(rating => rating === 'up').length;
    return { ...exchange, rated: cast.length > 0, score: up - (cast.length - up) };
  });
}
