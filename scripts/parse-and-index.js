#!/usr/bin/env node
/**
 * One-time (and re-run-when-scripts-change) indexing step.
 *
 * Reads every script file in data/scripts/, extracts dialogue for the target
 * character (and her aliases), chunks it with surrounding context, embeds
 * each chunk via Ollama, and writes the result to data/index.json.
 *
 * Each chunk stores its EN/JA/ZH text SEPARATELY — the reference text shown
 * to the model must stay single-language, or the model starts mimicking a
 * bilingual reply format. Embedding uses a combined string across all three
 * purely for multilingual search matching.
 *
 * Usage: node scripts/parse-and-index.js
 */

import 'dotenv/config';
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseScriptFile } from './lib/script-parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = join(__dirname, '..', 'data', 'scripts');
const OUTPUT_PATH = join(__dirname, '..', 'data', 'index.json');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'bge-m3';

// List every name she's credited under across the script (she starts as
// "Ghost", later becomes "Lena" — both point to the same character).
const TARGET_ALIASES = (process.env.SCRIPT_TARGET_ALIASES || 'Ghost,Lena')
  .split(',')
  .map(s => s.trim().toLowerCase());

const CHUNK_SIZE = 10;   // lines per chunk
const CHUNK_STRIDE = 7;  // step between chunk starts (creates overlap for context continuity)

// ── Render a window of rows into readable text in ONE language ─────────────
function renderWindowLang(rows, lang) {
  const lines = rows
    .map(r => {
      let speaker, text;
      if (lang === 'en') { speaker = r.enCharacter; text = r.enDialogue; }
      else if (lang === 'ja') { speaker = r.jpActor; text = r.jpDialogue; }
      else if (lang === 'zh') { speaker = r.cnCharacter; text = r.cnDialogue; }
      else return null;

      if (!text) return null;
      return speaker ? `${speaker}: ${text}` : `(narration): ${text}`;
    })
    .filter(Boolean);

  return lines.length > 0 ? lines.join('\n') : null;
}

function isTargetLine(row) {
  return TARGET_ALIASES.includes((row.enCharacter || '').toLowerCase());
}

// ── Build overlapping chunks, keep only ones featuring the target character ─
function buildChunks(rows, file) {
  const chunks = [];
  for (let start = 0; start < rows.length; start += CHUNK_STRIDE) {
    const window = rows.slice(start, start + CHUNK_SIZE);
    if (window.length === 0) break;
    if (!window.some(isTargetLine)) {
      if (start + CHUNK_SIZE >= rows.length) break;
      continue;
    }

    const textEn = renderWindowLang(window, 'en');
    const textJa = renderWindowLang(window, 'ja');
    const textZh = renderWindowLang(window, 'zh');

    if (textEn || textJa || textZh) {
      chunks.push({
        file,
        lineStart: window[0].line,
        lineEnd: window[window.length - 1].line,
        textEn,
        textJa,
        textZh,
      });
    }

    if (start + CHUNK_SIZE >= rows.length) break;
  }
  return chunks;
}

async function embed(text) {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  if (!res.ok) throw new Error(`Embedding request failed: HTTP ${res.status}`);
  const data = await res.json();
  return data.embedding;
}

async function main() {
  if (!existsSync(SCRIPTS_DIR)) {
    console.error(`❌ ${SCRIPTS_DIR} does not exist. Create it and copy your script files there first.`);
    process.exit(1);
  }

  const files = readdirSync(SCRIPTS_DIR).filter(f => !f.startsWith('.'));
  if (files.length === 0) {
    console.error(`❌ No script files found in ${SCRIPTS_DIR}`);
    process.exit(1);
  }

  console.log(`📖 Found ${files.length} script file(s). Parsing...`);

  const allChunks = [];
  for (const file of files) {
    const text = readFileSync(join(SCRIPTS_DIR, file), 'utf-8');
    const rows = parseScriptFile(text);
    const chunks = buildChunks(rows, file);
    allChunks.push(...chunks);
    console.log(`  ${file}: ${rows.length} lines → ${chunks.length} chunk(s) featuring the target character`);
  }

  console.log(`\n🧠 Embedding ${allChunks.length} chunks with "${EMBED_MODEL}"... (this can take a while)`);

  const indexed = [];
  for (let i = 0; i < allChunks.length; i++) {
    const chunk = allChunks[i];
    // Combine all available languages purely for search matching — this
    // combined string is NEVER shown to the model, only textEn/textJa/textZh are.
    const embedInput = [chunk.textEn, chunk.textJa, chunk.textZh].filter(Boolean).join(' / ');

    try {
      const embedding = await embed(embedInput);
      indexed.push({ ...chunk, embedding });
    } catch (error) {
      console.error(`⚠️  Failed to embed chunk ${i} (${chunk.file}:${chunk.lineStart}):`, error.message);
    }
    if ((i + 1) % 25 === 0 || i === allChunks.length - 1) {
      console.log(`  ${i + 1}/${allChunks.length}`);
    }
  }

  if (!existsSync(dirname(OUTPUT_PATH))) mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(indexed));

  console.log(`\n✅ Wrote ${indexed.length} embedded chunks to ${OUTPUT_PATH}`);
}

main();