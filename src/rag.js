/**
 * Runtime retrieval — loads the pre-built index from data/index.db (see
 * scripts/parse-and-index.js) and finds the most relevant script chunks for
 * a given user message via cosine similarity.
 */

import { character } from './character.js';
import { cosineSimilarity, EMBED_MODEL, embedBatch } from './ollama.js';
import { needsGentleReply } from './safety.js';
import { rerank } from './rerank.js';
import { readSceneIndex, SCENE_INDEX_PATH } from './sceneIndex.js';

// scripts/parse-and-index.js embeds through here, so indexing and search match.
export { embedBatch };

// A fact card has to score this well to count as relevant. Measured with bge-m3:
// 36 of 39 lore questions reach it, and 1 of 27 bits of small talk does.
const FACT_MIN_SCORE = 0.5;
const MAX_FACTS = 3;
const QUESTION =
  /\?\s*$|^(?:who|what|what's|whats|where|when|why|how|which|does|do|did|is|are|can|could|will|would|should|tell me)\b/i;
const FOLLOW_UP = /\b(?:she|her|hers|he|him|his|they|them|their|that|it|this|those|these)\b/i;
// A message this short rarely says what it's about on its own.
const SHORT_MESSAGE_WORDS = 4;
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

  const stored = readSceneIndex();
  if (!stored) {
    console.warn(`⚠️  No RAG index found at ${SCENE_INDEX_PATH} — run "npm run index" first.`);
    index = [];
    return index;
  }

  // Comparing vectors from two different models gives confident nonsense.
  if (stored.model !== EMBED_MODEL) {
    console.warn(
      `⚠️  The RAG index was built with "${stored.model}", not "${EMBED_MODEL}". Run "npm run index" again. Continuing without script scenes.`
    );
    index = [];
    return index;
  }

  index = stored.scenes;
  console.log(`📚 Loaded ${index.length} script chunks for RAG.`);
  return index;
}

async function embed(text) {
  return (await embedBatch([text]))[0];
}

// How many scenes she can search, for /status: all of them, and those left once the
// late reveals are filtered out. Zero means no index, or one built with another model.
export function sceneCounts() {
  return { total: loadIndex().length, usable: allowedChunks().length };
}

// Loads the embedding model, and the scene index with it, before the first message.
export async function warmUpRetrieval() {
  loadIndex();
  await embedBatch(['warm up']);
}

function tokenize(text) {
  return (
    text
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .match(/[a-z0-9']+/g) ?? []
  );
}

// Word statistics for BM25, built once from the scenes she's allowed to see.
function buildKeywordIndex(chunks) {
  const documentFrequency = new Map();
  const documents = chunks.map((chunk) => {
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
  allowed ??= loadIndex().filter((chunk) => !character.spoilerNames.test(chunk.text));
  return allowed;
}

// Returns the topK most relevant script chunks for the given user message.
export async function retrieveRelevant(query, topK) {
  const chunks = allowedChunks();
  if (chunks.length === 0) return [];

  const queryEmbedding = await embed(query);

  let ranked = chunks
    .map((chunk) => ({
      ...chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))
    .sort((a, b) => b.score - a.score);

  if (RAG_HYBRID) {
    keywordIndex ??= buildKeywordIndex(chunks);
    const queryTerms = [...new Set(tokenize(query))];
    const byKeyword = keywordIndex.documents
      .map((document) => ({ document, score: keywordScore(document, queryTerms, keywordIndex) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ document }) => document.chunk);
    const byPosition = new Map(ranked.map((chunk) => [`${chunk.file}:${chunk.lineStart}`, chunk]));
    ranked = fuseRankings(
      ranked,
      byKeyword.map((chunk) => byPosition.get(`${chunk.file}:${chunk.lineStart}`))
    );
  }

  if (RAG_RERANK) {
    const candidates = ranked.slice(0, RERANK_CANDIDATES);
    try {
      const scores = await rerank(
        query,
        candidates.map((chunk) => chunk.text)
      );
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
  factEmbeddings ??= embedBatch(character.facts.map((fact) => fact.text)).catch((error) => {
    factEmbeddings = null;
    throw error;
  });
  return factEmbeddings;
}

function namedFacts(text) {
  return character.facts.filter((fact) => fact.match.test(text));
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

// What to search scenes with. "How much?" finds nothing by itself, so follow-up
// questions bring the message before them along: on 20 follow-ups, that found 10
// scenes to 2. Only questions: "haha ok" doing the same pulled up the previous
// reply's scenes again, and she repeated herself about twice as often. Doing it for
// every message cost standalone ones most of all (15 of 26, against 18 with this
// check and 20 with no history).
function sceneQuery(content, userMessages) {
  const previous = userMessages.at(-2);
  const isFollowUp =
    QUESTION.test(content) &&
    (content.split(/\s+/).length <= SHORT_MESSAGE_WORDS || FOLLOW_UP.test(content));
  return previous && isFollowUp ? `${previous}\n${content}` : content;
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
// group is { speaker, recent }, when several people share this conversation.
// earlier is what they said before the turns the model sees (see recentStart in
// llm.js). It goes early for the same reason, so she doesn't answer it all over again.
// Returns the prompt, whether it has facts she needs to repeat, and whether a hint
// tells her what to say (see chatFresh).
export async function buildSystemPrompt(
  content,
  topK,
  userMessages = [content],
  remembered = [],
  group = null,
  earlier = [],
  overheard = null
) {
  if (needsGentleReply(userMessages)) {
    return { prompt: character.griefPrompt, factual: false, scripted: false };
  }

  const situation = character.situations.find((s) => s.match.test(content));
  const hint = situation ? `\n${situation.hint}` : '';

  let referenceBlock = '';
  let factBlock = '';
  try {
    const facts = await retrieveFacts(content, userMessages);
    if (facts.length > 0) {
      factBlock = `\n\nWhat you know about this:\n${facts
        .map((fact) => `- ${fact.text}`)
        .join('\n')}`;
    }

    const relevant =
      situation || facts.length > 0
        ? []
        : await retrieveRelevant(sceneQuery(content, userMessages), topK);
    if (relevant.length > 0) {
      referenceBlock = `\n\nPast scenes that may be relevant:\n\n${relevant
        .map((r) => `--- ${r.file} (lines ${r.lineStart}-${r.lineEnd}) ---\n${r.text}`)
        .join('\n\n')}`;
    }
  } catch (ragError) {
    console.warn('⚠️  RAG retrieval failed, continuing without it:', ragError.message);
  }
  const rememberedBlock =
    remembered.length > 0
      ? `\n\nWhat this person has told you about themselves before. Bring it up only if it's relevant:\n${remembered
          .map((fact) => `- ${fact}`)
          .join('\n')}`
      : '';
  const earlierBlock =
    earlier.length > 0
      ? `\n\nWhat they've told you earlier in this conversation. Bring it up only if it's relevant:\n${earlier
          .map((line) => `- ${line}`)
          .join('\n')}`
      : '';

  // Goes last, because the names in history alone weren't enough: she told Ben about
  // "your cat" when the cat was Ana's. It has to say whose "my" this is.
  const groupBlock = group
    ? `\n\nSeveral different people are talking to you here. You call all of them Nine, and only Kakeru is Captain. Who's said what:\n${group.recent
        .map((line) => `- ${line.speaker} said: ${line.content}`)
        .join(
          '\n'
        )}\nYou're answering ${group.speaker} now. When ${group.speaker} says "I" or "my", that means ${group.speaker} and nobody else.`
    : '';
  const speaker = group?.speaker ?? 'Nine';
  // "Reply as": someone picked a message from a chat for her to answer, and it was
  // probably said to someone else. Told it was said to her, she answered a friend's
  // "nope, I'm cooked" as if it were about her, and took "you're insane" as an insult.
  const said =
    overheard && !overheard.toHer
      ? `${speaker} just said this in the chat, to the others there, not to you. You're butting in with your own two cents, so react to it; don't answer it as if they'd said it to you. If you can't tell what they're on about, say so instead of guessing: ${content}`
      : `${speaker} just said: ${content}`;

  return {
    prompt: `${character.systemPrompt}${rememberedBlock}${earlierBlock}${referenceBlock}\n\n${character.validation}${factBlock}${groupBlock}\n\n${said}${hint}`,
    factual: factBlock !== '',
    scripted: Boolean(situation),
  };
}
