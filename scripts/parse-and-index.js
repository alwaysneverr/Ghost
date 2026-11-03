#!/usr/bin/env node
/**
 * One-time (and re-run-when-scripts-change) indexing step.
 *
 * Reads every script file in data/scripts/, cuts a short scene around each of the
 * target character's lines (and her aliases'), embeds each scene via Ollama, and
 * writes the result to data/index.db. Only the English columns are used. Scenes
 * that haven't changed keep their embeddings, so re-runs only pay for what's new.
 *
 * Usage: node scripts/parse-and-index.js
 */

import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseScriptFile, listScriptFiles, targetAliases, isTargetRow, renderRows } from './lib/script-parser.js';
import { embedBatch } from '../src/rag.js';
import { readSceneIndex, writeSceneIndex, SCENE_INDEX_PATH } from '../src/sceneIndex.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = join(__dirname, '..', 'data', 'scripts');

const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'bge-m3';
const EMBED_BATCH_SIZE = 32;

// Every name she's credited under across the script (she starts as "Ghost",
// later becomes "Lena" — both point to the same character).
const TARGET_ALIASES = targetAliases();

// A scene is what led up to her line, plus the reaction, and exchanges close
// together merge up to MAX_SCENE_LINES. The scripts have no scene markers. Tested on
// 222 queries against fixed 10-line windows, this found 129 replies to 115 (p=0.013)
// while sending the model 28% less text. Inferring scene breaks didn't help: cutting
// at runs of narration did worse, and at shifts in topic made no difference.
const LINES_BEFORE = 3;
const LINES_AFTER = 1;
const MAX_SCENE_LINES = 10;

function buildChunks(rows, file) {
  const spans = [];
  rows.forEach((row, i) => {
    if (!isTargetRow(row, TARGET_ALIASES)) return;
    const start = Math.max(0, i - LINES_BEFORE);
    const end = Math.min(rows.length, i + LINES_AFTER + 1);
    const last = spans.at(-1);
    if (last && start <= last.end && end - last.start <= MAX_SCENE_LINES) last.end = end;
    else spans.push({ start, end });
  });

  const chunks = [];
  for (const { start, end } of spans) {
    const window = rows.slice(start, end);
    const text = renderRows(window);
    if (text) {
      chunks.push({
        file,
        lineStart: window[0].line,
        lineEnd: window[window.length - 1].line,
        text,
      });
    }
  }
  return chunks;
}

// Embeddings for the scenes that need them. If a batch fails, tries its scenes one
// by one, so one bad scene doesn't cost the other 31.
async function embedAll(chunks) {
  const embedded = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
    try {
      const embeddings = await embedBatch(batch.map(chunk => chunk.text));
      batch.forEach((chunk, j) => embedded.push({ ...chunk, embedding: embeddings[j] }));
    } catch (error) {
      console.warn(`⚠️  Batch failed (${error.message}), trying its scenes one at a time.`);
      for (const chunk of batch) {
        try {
          const [embedding] = await embedBatch([chunk.text]);
          embedded.push({ ...chunk, embedding });
        } catch (singleError) {
          console.error(`⚠️  Failed to embed ${chunk.file}:${chunk.lineStart}:`, singleError.message);
        }
      }
    }
    console.log(`  ${Math.min(i + EMBED_BATCH_SIZE, chunks.length)}/${chunks.length}`);
  }
  return embedded;
}

async function main() {
  if (!existsSync(SCRIPTS_DIR)) {
    console.error(`❌ ${SCRIPTS_DIR} does not exist. Create it and copy your script files there first.`);
    process.exit(1);
  }

  const files = listScriptFiles(SCRIPTS_DIR);
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

  // Embeddings from a different model can't be compared, so none of them carry over.
  const previous = readSceneIndex();
  const reusable = previous?.model === EMBED_MODEL ? previous.scenes : [];
  const known = new Map(reusable.map(scene => [scene.text, scene.embedding]));

  const unchanged = allChunks.filter(chunk => known.has(chunk.text));
  const changed = allChunks.filter(chunk => !known.has(chunk.text));

  console.log(`\n🧠 ${unchanged.length} scene(s) unchanged. Embedding ${changed.length} with "${EMBED_MODEL}"...`);
  const embedded = await embedAll(changed);

  // Back in script order, whichever group each scene came from.
  const byText = new Map(embedded.map(chunk => [chunk.text, chunk.embedding]));
  const indexed = allChunks
    .map(chunk => ({ ...chunk, embedding: known.get(chunk.text) ?? byText.get(chunk.text) }))
    .filter(chunk => chunk.embedding);

  writeSceneIndex(indexed, EMBED_MODEL);
  console.log(`\n✅ Wrote ${indexed.length} embedded chunks to ${SCENE_INDEX_PATH}`);
}

main();
