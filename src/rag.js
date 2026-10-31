/**
 * Runtime retrieval — loads the pre-built index from data/index.json (see
 * scripts/parse-and-index.js) and finds the most relevant script chunks for
 * a given user message via cosine similarity.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { character } from './character.js';
import { needsGentleReply } from './safety.js';
import { rerank } from './rerank.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = join(__dirname, '..', 'data', 'index.json');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'bge-m3';

// A fact card has to score this well to count as relevant. Measured with bge-m3:
// 36 of 39 lore questions reach it, and 1 of 27 bits of small talk does.
const FACT_MIN_SCORE = 0.5;
const MAX_FACTS = 3;
const QUESTION = /\?\s*$|^(?:who|what|what's|whats|where|when|why|how|which|does|do|did|is|are|can|could|tell me)\b/i;
const FOLLOW_UP = /\b(?:she|her|hers|he|him|his|they|them|their|that|it)\b/i;
const FOLLOW_UP_REACH = 5; // how many of their earlier messages a follow-up looks back over
const FIRST_PERSON = /\b(?:i|i'm|im|my|mine)\b/i;

const RAG_HYBRID = process.env.RAG_HYBRID === 'true';
const RAG_RERANK = process.env.RAG_RERANK === 'true';
const RERANK_CANDIDATES = 20;
// The usual defaults for BM25 and reciprocal rank fusion.
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const RRF_K = 60;

let index = null;
let allowed = null;
let keywordIndex = null;
let factEmbeddings = null;

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

function tokenize(text) {
  return text.toLowerCase().replace(/[’‘]/g, "'").match(/[a-z0-9']+/g) ?? [];
}

// Word statistics for BM25, built once from the scenes she's allowed to see.
function buildKeywordIndex(chunks) {
  const documentFrequency = new Map();
  const documents = chunks.map(chunk => {
    const tokens = tokenize(chunk.text);
    const termCounts = new Map();
    for (const token of tokens) termCounts.set(token, (termCounts.get(token) ?? 0) + 1);
    for (const term of termCounts.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
    return { chunk, termCounts, length: tokens.length };
  });
  const averageLength = documents.reduce((sum, d) => sum + d.length, 0) / documents.length;
  return { documents, documentFrequency, averageLength };
}

function keywordScore(document, queryTerms, { documents, documentFrequency, averageLength }) {
  let score = 0;
  for (const term of queryTerms) {
    const frequency = document.termCounts.get(term);
    if (!frequency) continue;
    const df = documentFrequency.get(term);
    const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
    score +=
      (idf * frequency * (BM25_K1 + 1)) /
      (frequency + BM25_K1 * (1 - BM25_B + (BM25_B * document.length) / averageLength));
  }
  return score;
}

// Merges two rankings by position rather than score, since the scores aren't
// comparable. A scene ranked well by either one, or fairly well by both, rises.
function fuseRankings(byEmbedding, byKeyword) {
  const fused = new Map();
  for (const ranking of [byEmbedding, byKeyword]) {
    ranking.forEach((chunk, rank) => {
      fused.set(chunk, (fused.get(chunk) ?? 0) + 1 / (RRF_K + rank + 1));
    });
  }
  return [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([chunk, score]) => ({ ...chunk, score }));
}

// Scenes naming late-reveal characters are never candidates.
function allowedChunks() {
  allowed ??= loadIndex().filter(chunk => !character.spoilerNames.test(chunk.text));
  return allowed;
}

// Returns the topK most relevant script chunks for the given user message.
export async function retrieveRelevant(query, topK = 4) {
  const chunks = allowedChunks();
  if (chunks.length === 0) return [];

  const queryEmbedding = await embed(query);

  let ranked = chunks
    .map(chunk => ({
      ...chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))
    .sort((a, b) => b.score - a.score);

  if (RAG_HYBRID) {
    keywordIndex ??= buildKeywordIndex(chunks);
    const queryTerms = [...new Set(tokenize(query))];
    const byKeyword = keywordIndex.documents
      .map(document => ({ document, score: keywordScore(document, queryTerms, keywordIndex) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ document }) => document.chunk);
    const byPosition = new Map(ranked.map(chunk => [`${chunk.file}:${chunk.lineStart}`, chunk]));
    ranked = fuseRankings(
      ranked,
      byKeyword.map(chunk => byPosition.get(`${chunk.file}:${chunk.lineStart}`))
    );
  }

  if (RAG_RERANK) {
    const candidates = ranked.slice(0, RERANK_CANDIDATES);
    try {
      const scores = await rerank(query, candidates.map(chunk => chunk.text));
      return candidates
        .map((chunk, i) => ({ ...chunk, score: scores[i] }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    } catch (error) {
      console.warn('⚠️  Reranking failed, using the unranked order:', error.message);
    }
  }

  return ranked.slice(0, topK);
}

// Embedded once, the first time they're needed. Not cached if it fails, so the
// next message tries again.
function loadFactEmbeddings() {
  factEmbeddings ??= Promise.all(character.facts.map(fact => embed(fact.text))).catch(error => {
    factEmbeddings = null;
    throw error;
  });
  return factEmbeddings;
}

function namedFacts(text) {
  return character.facts.filter(fact => fact.match.test(text));
}

// The fact cards for a message: those it names, then those it's closest to.
export async function retrieveFacts(content, userMessages = [content]) {
  const named = namedFacts(content);
  const isQuestion = QUESTION.test(content);

  // "What's her power?" names nobody, and similarity alone would pick whichever
  // card says "power" loudest, so it goes by who they were last talking about.
  if (named.length === 0 && isQuestion && FOLLOW_UP.test(content)) {
    for (const earlier of userMessages.slice(-FOLLOW_UP_REACH - 1, -1).reverse()) {
      const facts = namedFacts(earlier);
      if (facts.length > 0) return facts.slice(0, MAX_FACTS);
    }
  }

  // "My sister is so annoying" is about their life, not Sora.
  if (named.length >= MAX_FACTS || !isQuestion || FIRST_PERSON.test(content)) {
    return named.slice(0, MAX_FACTS);
  }

  const [queryEmbedding, embeddings] = await Promise.all([embed(content), loadFactEmbeddings()]);
  const similar = character.facts
    .map((fact, i) => ({ fact, score: cosineSimilarity(queryEmbedding, embeddings[i]) }))
    .filter(({ fact, score }) => score >= FACT_MIN_SCORE && !named.includes(fact))
    .sort((a, b) => b.score - a.score)
    .map(({ fact }) => fact);

  return [...named, ...similar].slice(0, MAX_FACTS);
}

// The full system prompt for one message — shared by the bot (messageCreate.js)
// and scripts/eval-prompts.js so both send exactly the same thing. Validation
// and their message go last, so a retrieved scene isn't the most recent thing
// the model read: it would otherwise carry on the scene instead of replying.
// Someone hurting gets the short griefPrompt instead, with no scenes at all.
// Fact cards replace scenes when there are any, because the scenes contradict
// them: with both, she answers from whichever is more dramatic.
// What she remembers about the speaker goes early, not last: she recites whatever
// she read most recently, and this should only come up when it's relevant.
// Returns the prompt, and whether it has facts she needs to repeat (see chatFresh).
export async function buildSystemPrompt(content, topK = 4, userMessages = [content], remembered = []) {
  if (needsGentleReply(userMessages)) return { prompt: character.griefPrompt, factual: false };

  const situation = character.situations.find(s => s.match.test(content));
  const hint = situation ? `\n${situation.hint}` : '';

  let referenceBlock = '';
  let factBlock = '';
  try {
    const facts = await retrieveFacts(content, userMessages);
    if (facts.length > 0) {
      factBlock = `\n\nWhat you know about this:\n${facts
        .map(fact => `- ${fact.text}`)
        .join('\n')}`;
    }

    const relevant =
      situation || facts.length > 0 ? [] : (await retrieveRelevant(content, topK)).filter(r => r.text);
    if (relevant.length > 0) {
      referenceBlock = `\n\nPast scenes that may be relevant:\n\n${relevant
        .map(r => `--- ${r.file} (lines ${r.lineStart}-${r.lineEnd}) ---\n${r.text}`)
        .join('\n\n')}`;
    }
  } catch (ragError) {
    console.warn('⚠️  RAG retrieval failed, continuing without it:', ragError.message);
  }
  const rememberedBlock =
    remembered.length > 0
      ? `\n\nWhat this person has told you about themselves before. Bring it up only if it's relevant:\n${remembered
          .map(fact => `- ${fact}`)
          .join('\n')}`
      : '';

  return {
    prompt: `${character.systemPrompt}${rememberedBlock}${referenceBlock}\n\n${character.validation}${factBlock}\n\nNine just said: ${content}${hint}`,
    factual: factBlock !== '',
  };
}