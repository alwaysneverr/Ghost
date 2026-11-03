#!/usr/bin/env node
/**
 * Builds a preference-tuning dataset for KTO from 👍/👎 ratings: each rated reply
 * becomes a prompt, a completion and whether people liked it. Unlike
 * export-training-data.js, this also learns from the 👎s. Ties are dropped, since
 * raters who disagree teach it nothing.
 *
 * Usage: node scripts/export-preference-data.js
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { character } from '../src/character.js';
import { loadRatedExchanges } from './lib/ratings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'data', 'preference-data.jsonl');

// Below this, KTO has too little to learn from and will mostly memorise.
const MIN_USEFUL_RATINGS = 200;

function main() {
  const exchanges = loadRatedExchanges();
  const decided = exchanges.filter(ex => ex.score !== 0);
  const liked = decided.filter(ex => ex.score > 0).length;
  const ties = exchanges.filter(ex => ex.rated && ex.score === 0).length;

  console.log(`📊 ${exchanges.length} logged exchange(s): ${liked} 👍, ${decided.length - liked} 👎, ${ties} tied (dropped).`);
  if (decided.length < MIN_USEFUL_RATINGS) {
    console.warn(`⚠️  Only ${decided.length} rated replies. Aim for at least ${MIN_USEFUL_RATINGS}, with both 👍 and 👎, before trusting a preference-tuned model.`);
  }

  const rows = decided.map(ex => ({
    prompt: [
      { role: 'system', content: character.trainingPrompt },
      { role: 'user', content: ex.userMessage },
    ],
    completion: [{ role: 'assistant', content: ex.botReply }],
    label: ex.score > 0,
  }));

  writeFileSync(OUTPUT_PATH, rows.map(r => JSON.stringify(r)).join('\n'));
  console.log(`✅ Wrote ${rows.length} example(s) to ${OUTPUT_PATH}`);
}

main();
