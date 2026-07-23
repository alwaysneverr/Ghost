#!/usr/bin/env node
/**
 * Builds a fine-tuning dataset from logged conversations, keeping only
 * exchanges someone rated 👍 in Discord. Run this after collecting and
 * rating a batch of conversations.
 *
 * Usage: node scripts/export-training-data.js
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { character } from '../src/character.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = join(__dirname, '..', 'data', 'logs', 'conversations.jsonl');
const OUTPUT_PATH = join(__dirname, '..', 'data', 'training-data.jsonl');

function main() {
  if (!existsSync(LOG_PATH)) {
    console.error(`❌ No log file found at ${LOG_PATH}`);
    process.exit(1);
  }

  const lines = readFileSync(LOG_PATH, 'utf-8').split('\n').filter(Boolean);

  const exchanges = new Map(); // messageId -> exchange
  const ratings = new Map();   // messageId -> 'up' | 'down' (last rating wins)

  for (const line of lines) {
    const entry = JSON.parse(line);
    if (entry.type === 'exchange') {
      exchanges.set(entry.messageId, entry);
    } else if (entry.type === 'rating') {
      ratings.set(entry.messageId, entry.rating);
    }
  }

  const approved = [...exchanges.values()].filter(ex => ratings.get(ex.messageId) === 'up');

  console.log(`📊 ${exchanges.size} logged exchange(s), ${approved.length} approved (👍) for training.`);
  if (approved.length < 50) {
    console.warn(`⚠️  Only ${approved.length} approved examples — aim for a few hundred for a meaningful fine-tune. Keep chatting and rating good replies.`);
  }

  const trainingRows = approved.map(ex => ({
    messages: [
      { role: 'system', content: character.systemPrompt },
      { role: 'user', content: ex.userMessage },
      { role: 'assistant', content: ex.botReply },
    ],
  }));

  writeFileSync(OUTPUT_PATH, trainingRows.map(r => JSON.stringify(r)).join('\n'));
  console.log(`✅ Wrote ${trainingRows.length} training example(s) to ${OUTPUT_PATH}`);
}

main();