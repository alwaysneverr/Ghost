#!/usr/bin/env node
/**
 * Builds fine-tuning examples directly from the VN script itself — the
 * character's real, human-written dialogue — instead of from the bot's own
 * generated conversation logs. This is the stronger data source: it can't
 * reinforce the model's own mistakes the way self-generated logs can.
 *
 * For every line the target character speaks, the preceding conversation
 * turn becomes the "user" message and her line(s) become the "assistant"
 * response. Each example is generated once per language (EN/JA/ZH) using
 * that language's parallel text, so the model learns a consistent voice in
 * whichever language the conversation is actually happening in.
 *
 * Usage: node scripts/export-script-training-data.js
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseScriptFile } from './lib/script-parser.js';
import { character } from '../src/character.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = join(__dirname, '..', 'data', 'scripts');
const OUTPUT_PATH = join(__dirname, '..', 'data', 'script-training-data.jsonl');

const TARGET_ALIASES = (process.env.SCRIPT_TARGET_ALIASES || 'Ghost,Lena')
  .split(',')
  .map(s => s.trim().toLowerCase());

// How many prior turns to include as conversation history before each of
// her lines — kept modest so examples resemble the short back-and-forth
// the bot actually has at runtime.
const MAX_CONTEXT_TURNS = 4;

function isTargetRow(row) {
  return TARGET_ALIASES.includes((row.enCharacter || '').toLowerCase());
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

// ── Render a turn's text in one language ────────────────────────────────
function renderTurn(turn, lang) {
  const lines = turn.rows
    .map(row => {
      let speaker, text;
      if (lang === 'en') { speaker = row.enCharacter; text = row.enDialogue; }
      else if (lang === 'ja') { speaker = row.jpActor; text = row.jpDialogue; }
      else if (lang === 'zh') { speaker = row.cnCharacter; text = row.cnDialogue; }
      else return null;

      if (!text) return null;
      return speaker ? `${speaker}: ${text}` : `(narration): ${text}`;
    })
    .filter(Boolean);

  return lines.length > 0 ? lines.join('\n') : null;
}

// ── Build training examples from one file's turns ───────────────────────
function buildExamples(turns, file) {
  const examples = [];

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (!isTargetRow(turn.rows[0])) continue;
    if (i === 0) continue; // no prior context to respond to

    const contextTurns = turns.slice(Math.max(0, i - MAX_CONTEXT_TURNS), i);

    for (const lang of ['en', 'ja', 'zh']) {
      const history = [];
      let ok = true;

      for (const ctxTurn of contextTurns) {
        const text = renderTurn(ctxTurn, lang);
        if (!text) { ok = false; break; }
        history.push({
          role: isTargetRow(ctxTurn.rows[0]) ? 'assistant' : 'user',
          content: text,
        });
      }
      if (!ok || history.length === 0 || history[0].role !== 'user') continue;

      const responseText = renderTurn(turn, lang);
      if (!responseText) continue;

      examples.push({
        messages: [
          { role: 'system', content: character.systemPrompt },
          ...history,
          { role: 'assistant', content: responseText },
        ],
        _meta: { file, line: turn.rows[0].line, lang },
      });
    }
  }

  return examples;
}

function main() {
  if (!existsSync(SCRIPTS_DIR)) {
    console.error(`❌ ${SCRIPTS_DIR} does not exist.`);
    process.exit(1);
  }

  const files = readdirSync(SCRIPTS_DIR).filter(f => !f.startsWith('.'));
  if (files.length === 0) {
    console.error(`❌ No script files found in ${SCRIPTS_DIR}`);
    process.exit(1);
  }

  const all = [];
  for (const file of files) {
    const text = readFileSync(join(SCRIPTS_DIR, file), 'utf-8');
    const rows = parseScriptFile(text);
    const turns = groupIntoTurns(rows);
    const examples = buildExamples(turns, file);
    all.push(...examples);
    console.log(`  ${file}: ${rows.length} lines → ${examples.length} training example(s)`);
  }

  // Strip internal metadata — the training format only needs "messages"
  const clean = all.map(({ _meta, ...rest }) => rest);
  writeFileSync(OUTPUT_PATH, clean.map(r => JSON.stringify(r)).join('\n'));

  const byLang = { en: 0, ja: 0, zh: 0 };
  for (const ex of all) byLang[ex._meta.lang]++;

  console.log(`\n✅ Wrote ${clean.length} training example(s) to ${OUTPUT_PATH}`);
  console.log(`   (English: ${byLang.en}, Japanese: ${byLang.ja}, Chinese: ${byLang.zh})`);
}

main();