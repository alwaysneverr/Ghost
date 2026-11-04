#!/usr/bin/env node
/**
 * Builds fine-tuning examples directly from the VN script itself — the
 * character's real, human-written dialogue — instead of from the bot's own
 * generated conversation logs. This is the stronger data source: it can't
 * reinforce the model's own mistakes the way self-generated logs can.
 *
 * For every line the target character speaks, the preceding conversation
 * turn becomes the "user" message and her line(s) become the "assistant"
 * response. Only the English columns are used.
 *
 * Some whole script files go to data/holdout.jsonl instead, so models can be tested
 * on her lines they never trained on (scripts/eval-holdout.js).
 *
 * Usage: node scripts/export-script-training-data.js
 */

import 'dotenv/config';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  parseScriptFile,
  listScriptFiles,
  targetAliases,
  isTargetRow as isAliasRow,
  renderRows,
  renderReply,
} from './lib/script-parser.js';
import { character } from '../src/character.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = join(__dirname, '..', 'data', 'scripts');
const OUTPUT_PATH = join(__dirname, '..', 'data', 'script-training-data.jsonl');
const HOLDOUT_PATH = join(__dirname, '..', 'data', 'holdout.jsonl');

const TARGET_ALIASES = targetAliases();

// Whole files, not random examples: neighbouring examples share context, and one
// example's reply is part of the next one's context, so a random split would test
// models on text they trained on.
const HOLDOUT_SHARE = 0.15;

// How many prior turns to include as conversation history before each of
// her lines — kept modest so examples resemble the short back-and-forth
// the bot actually has at runtime.
const MAX_CONTEXT_TURNS = 4;

// Narration-heavy turns can run to thousands of characters. Training cuts
// anything past its length limit (2,048 tokens) off the END, which would lose
// the reply being learned from, so context is trimmed here instead. Roughly
// 1,250 tokens, leaving room for the system prompt and her reply.
const MAX_CONTEXT_CHARS = 5000;

function isTargetRow(row) {
  return isAliasRow(row, TARGET_ALIASES);
}

// ── Group consecutive rows into speaker "turns" ─────────────────────────
// Non-target speakers (side characters + narration) collapse into a single
// turn so the final sequence strictly alternates user/assistant.
function groupIntoTurns(rows) {
  const turns = [];
  for (const row of rows) {
    const speakerKey = row.enCharacter || ''; // '' = narration
    const isTarget = isTargetRow(row);
    const last = turns[turns.length - 1];
    const lastIsTarget = last && isTargetRow(last.rows[0]);

    if (last && (last.speakerKey === speakerKey || (!isTarget && !lastIsTarget))) {
      last.rows.push(row);
    } else {
      turns.push({ speakerKey, rows: [row] });
    }
  }
  return turns;
}

// ── Keep the most recent context that fits in MAX_CONTEXT_CHARS ─────────
// Drops whole turns from the oldest end, then the oldest lines of the turn
// that didn't fit. The conversation must open with a user turn, so a leading
// assistant turn goes too. Returns [] if nothing usable is left.
function capContext(history) {
  const capped = [];
  let remaining = MAX_CONTEXT_CHARS;

  for (let i = history.length - 1; i >= 0; i--) {
    const { role, content } = history[i];
    if (content.length <= remaining) {
      capped.unshift(history[i]);
      remaining -= content.length;
      continue;
    }

    const kept = [];
    for (const line of content.split('\n').reverse()) {
      if (line.length > remaining) break;
      kept.unshift(line);
      remaining -= line.length;
    }
    if (kept.length > 0) capped.unshift({ role, content: kept.join('\n') });
    break;
  }

  while (capped[0]?.role === 'assistant') capped.shift();
  return capped;
}

// ── Build training examples from one file's turns ───────────────────────
function buildExamples(turns) {
  const examples = [];

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (!isTargetRow(turn.rows[0])) continue;
    if (i === 0) continue; // no prior context to respond to

    const contextTurns = turns.slice(Math.max(0, i - MAX_CONTEXT_TURNS), i);

    const responseText = renderReply(turn.rows);
    // Skip replies that are only "..." — nothing worth learning there.
    if (!responseText || !/\p{L}/u.test(responseText)) continue;

    const history = [];
    for (const ctxTurn of contextTurns) {
      // Her turns are written as plain replies (no "Ghost:" prefix or
      // quote brackets) — exactly how the bot should answer on Discord.
      const isHers = isTargetRow(ctxTurn.rows[0]);
      const text = isHers ? renderReply(ctxTurn.rows) : renderRows(ctxTurn.rows);
      if (text) history.push({ role: isHers ? 'assistant' : 'user', content: text });
    }

    const capped = capContext(history);
    if (capped.length === 0) continue;

    examples.push({
      line: turn.rows[0].line,
      messages: [
        { role: 'system', content: character.trainingPrompt },
        ...capped,
        { role: 'assistant', content: responseText },
      ],
    });
  }

  return examples;
}

// Which files to hold out. Picked by hash of the name, so it's the same files every
// run, and adding a script doesn't reshuffle the rest.
function pickHoldoutFiles(examples) {
  const counts = new Map();
  for (const { file } of examples) counts.set(file, (counts.get(file) ?? 0) + 1);

  const hash = (file) => createHash('sha256').update(file).digest('hex');
  const target = Math.round(examples.length * HOLDOUT_SHARE);
  const held = new Set();
  let total = 0;
  for (const file of [...counts.keys()].sort((a, b) => hash(a).localeCompare(hash(b)))) {
    if (total + counts.get(file) > target) continue;
    held.add(file);
    total += counts.get(file);
  }
  return held;
}

// Her line, ignoring case and punctuation. "Yeah." turns up all over the script, and
// a test line she trained on elsewhere isn't a fair test.
function replyKey(example) {
  return example.messages
    .at(-1)
    .content.toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function main() {
  if (!existsSync(SCRIPTS_DIR)) {
    console.error(`❌ ${SCRIPTS_DIR} does not exist.`);
    process.exit(1);
  }

  const files = listScriptFiles(SCRIPTS_DIR);
  if (files.length === 0) {
    console.error(`❌ No script files found in ${SCRIPTS_DIR}`);
    process.exit(1);
  }

  const all = [];
  for (const file of files) {
    const text = readFileSync(join(SCRIPTS_DIR, file), 'utf-8');
    const rows = parseScriptFile(text);
    const turns = groupIntoTurns(rows);
    const examples = buildExamples(turns);
    all.push(...examples.map((example) => ({ ...example, file })));
    console.log(`  ${file}: ${rows.length} lines → ${examples.length} example(s)`);
  }

  const heldFiles = pickHoldoutFiles(all);
  const train = all.filter((example) => !heldFiles.has(example.file));
  const seenInTraining = new Set(train.map(replyKey));
  const heldOut = all.filter((example) => heldFiles.has(example.file));
  const holdout = heldOut.filter((example) => !seenInTraining.has(replyKey(example)));

  writeFileSync(OUTPUT_PATH, train.map(({ messages }) => JSON.stringify({ messages })).join('\n'));
  writeFileSync(
    HOLDOUT_PATH,
    holdout
      .map(({ file, line, messages }) => JSON.stringify({ source: `${file}:${line}`, messages }))
      .join('\n')
  );

  console.log(`\n✅ Wrote ${train.length} training example(s) to ${OUTPUT_PATH}`);
  console.log(
    `✅ Wrote ${holdout.length} held-out example(s) from ${heldFiles.size} file(s) to ${HOLDOUT_PATH}`
  );
  console.log(
    `   Set aside and not used at all, because she says the same line in training: ${heldOut.length - holdout.length}`
  );
}

main();
