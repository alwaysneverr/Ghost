#!/usr/bin/env node
/**
 * Shows which script chunks the bot would retrieve for a message — the
 * quickest way to judge whether RAG is finding relevant scenes.
 *
 * Usage: npm run rag:check -- "why are you called Lena?" [--k 6]
 */

import 'dotenv/config';
import { retrieveFacts, retrieveRelevant } from '../src/rag.js';

const args = process.argv.slice(2);
const kIndex = args.indexOf('--k');
const topK = kIndex >= 0 ? Number(args.splice(kIndex, 2)[1]) : Number(process.env.RAG_TOP_K || 4);
const query = args.join(' ').trim();

if (!query) {
  console.error('Usage: npm run rag:check -- "<message>" [--k N]');
  process.exit(1);
}

const results = await retrieveRelevant(query, topK);
const facts = await retrieveFacts(query);

console.log(`\n🧾 Fact cards: ${facts.length} (scenes are skipped when there are any)\n`);
for (const fact of facts) console.log(`   ${fact.text}\n`);

console.log(`\n🔎 "${query}"  (top ${topK})\n`);
if (results.length === 0) console.log('No chunks found — has `npm run index` been run?');

results.forEach((r, i) => {
  const preview = (r.text || '(no text)').split('\n').slice(0, 3);
  console.log(`${i + 1}. score ${r.score.toFixed(3)}  ${r.file}:${r.lineStart}-${r.lineEnd}`);
  for (const line of preview) console.log(`     ${line.slice(0, 110)}`);
  console.log();
});
