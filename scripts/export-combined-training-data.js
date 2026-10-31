#!/usr/bin/env node
/**
 * Merges the script and 👍-log datasets into one file for fine-tuning: drops
 * duplicates, warns about stale data, and shuffles with a fixed seed so the same
 * inputs always give the same file. Run export:script and export:logs first.
 *
 * Usage: node scripts/export-combined-training-data.js [--script-weight N]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { character } from '../src/character.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const SCRIPT_PATH = join(DATA_DIR, 'script-training-data.jsonl');
const LOGS_PATH = join(DATA_DIR, 'training-data.jsonl');
const OUTPUT_PATH = join(DATA_DIR, 'combined-training-data.jsonl');

const SHUFFLE_SEED = 9;

// Script examples are already nearly all of the data, and repeating them raises
// the risk of her reciting lines (see GUIDE §4.4), so this defaults to 1.
function scriptWeight() {
  const flag = process.argv.indexOf('--script-weight');
  if (flag < 0) return 1;
  const weight = Number(process.argv[flag + 1]);
  if (!Number.isInteger(weight) || weight < 1) {
    console.error('❌ --script-weight needs a whole number of 1 or more.');
    process.exit(1);
  }
  return weight;
}

function readRows(path) {
  if (!existsSync(path)) {
    console.warn(`⚠️  ${path} not found, skipping it.`);
    return [];
  }
  return readFileSync(path, 'utf-8').split('\n').filter(Boolean).map(line => JSON.parse(line));
}

// The same conversation, ignoring case, punctuation and the system prompt.
function dedupeKey(row) {
  return row.messages
    .filter(m => m.role !== 'system')
    .map(m => `${m.role}:${m.content.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, '').trim()}`)
    .join('|');
}

// Fisher-Yates driven by mulberry32, since Math.random can't be seeded.
function shuffled(rows, seed) {
  let state = seed;
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const result = [...rows];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function main() {
  const weight = scriptWeight();
  const scriptRows = readRows(SCRIPT_PATH);
  const logRows = readRows(LOGS_PATH);

  const seen = new Set();
  const unique = rows =>
    rows.filter(row => {
      const key = dedupeKey(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const uniqueScript = unique(scriptRows);
  const uniqueLogs = unique(logRows);
  const merged = [...Array.from({ length: weight }, () => uniqueScript).flat(), ...uniqueLogs];

  if (merged.length === 0) {
    console.error('❌ Nothing to combine. Run `npm run export:script` first.');
    process.exit(1);
  }

  const stale = [...uniqueScript, ...uniqueLogs].filter(
    row => row.messages.find(m => m.role === 'system')?.content !== character.trainingPrompt
  ).length;
  if (stale > 0) {
    console.warn(`⚠️  ${stale} example(s) were exported with an older persona. Re-run export:script and export:logs before training.`);
  }

  const duplicates = scriptRows.length + logRows.length - uniqueScript.length - uniqueLogs.length;
  console.log(`📊 ${uniqueScript.length} script example(s) × ${weight}, ${uniqueLogs.length} from logs, ${duplicates} duplicate(s) dropped.`);

  writeFileSync(OUTPUT_PATH, shuffled(merged, SHUFFLE_SEED).map(r => JSON.stringify(r)).join('\n'));
  console.log(`✅ Wrote ${merged.length} example(s) to ${OUTPUT_PATH}`);
}

main();
