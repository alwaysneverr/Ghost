/**
 * Runtime retrieval — loads the pre-built index from data/index.json (see
 * scripts/parse-and-index.js) and finds the most relevant script chunks for
 * a given user message via cosine similarity.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = join(__dirname, '..', 'data', 'index.json');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'bge-m3';

let index = null;

function loadIndex() {
  if (index !== null) return index;

  if (!existsSync(INDEX_PATH)) {
    console.warn(`⚠️  No RAG index found at ${INDEX_PATH} — run "node scripts/parse-and-index.js" first.`);
    index = [];
    return index;
  }

  index = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
  console.log(`📚 Loaded ${index.length} script chunks for RAG.`);
  return index;
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Also used by scripts/parse-and-index.js so indexing and querying always
// embed the same way.
export async function embed(text) {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  if (!res.ok) throw new Error(`Embedding request failed: HTTP ${res.status}`);
  const data = await res.json();
  return data.embedding;
}

// Returns the topK most relevant script chunks for the given user message.
export async function retrieveRelevant(query, topK = 4) {
  const chunks = loadIndex();
  if (chunks.length === 0) return [];

  const queryEmbedding = await embed(query);

  const scored = chunks.map(chunk => ({
    ...chunk,
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// Rough language guess from the user's message so reference chunks can be
// shown in the same language. Kana means Japanese; Han without kana means
// Chinese; anything else falls back to English.
export function detectLang(text) {
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return 'ja';
  if (/\p{Script=Han}/u.test(text)) return 'zh';
  return 'en';
}

// Picks a chunk's single-language text (see parse-and-index.js for why the
// languages are kept separate), falling back to English when missing.
export function chunkText(chunk, lang) {
  const byLang = { en: chunk.textEn, ja: chunk.textJa, zh: chunk.textZh };
  return byLang[lang] || chunk.textEn || null;
}