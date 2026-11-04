#!/usr/bin/env node
/**
 * Builds a fine-tuning dataset from logged conversations, keeping only
 * exchanges rated more 👍 than 👎 in Discord. Run this after collecting and
 * rating a batch of conversations.
 *
 * Usage: node scripts/export-training-data.js
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { character } from '../src/character.js';
import { loadRatedExchanges } from './lib/ratings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'data', 'training-data.jsonl');

function main() {
  const exchanges = loadRatedExchanges();
  const approved = exchanges.filter((ex) => ex.score > 0);

  console.log(
    `📊 ${exchanges.length} logged exchange(s), ${approved.length} approved (👍) for training.`
  );
  if (approved.length < 50) {
    console.warn(
      `⚠️  Only ${approved.length} approved examples — aim for a few hundred for a meaningful fine-tune. Keep chatting and rating good replies.`
    );
  }

  const trainingRows = approved.map((ex) => ({
    messages: [
      { role: 'system', content: character.trainingPrompt },
      { role: 'user', content: ex.userMessage },
      { role: 'assistant', content: ex.botReply },
    ],
  }));

  writeFileSync(OUTPUT_PATH, trainingRows.map((r) => JSON.stringify(r)).join('\n'));
  console.log(`✅ Wrote ${trainingRows.length} training example(s) to ${OUTPUT_PATH}`);
}

main();
