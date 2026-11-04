/**
 * Catches her repeating herself in other words. dropHabits (llm.js) only sees exact
 * wording, so "I'll kill 'em", "I'll gut 'em" and "I'll beat 'em" all got through. This
 * compares each sentence's meaning, by embedding, with what she said in her last few
 * replies.
 *
 * The cut-off came from 1,800 saved replies in 180 conversations. Sentences repeating
 * an earlier one with a word or two changed scored 0.92 in the middle, and every other
 * pair 0.52. At 0.85 it catches 67 of 91 of those repeats, and flags 94 of 56,392 other
 * pairs, which on reading were mostly repeats of meaning: "Get the hell outta my way"
 * after "Now get the hell outta my face". Lower, it starts catching "C'mon, get up"
 * after "C'mon, let's go somewhere".
 */

import { cosineSimilarity, embedBatch } from './ollama.js';

// HABIT_SIMILARITY=1 turns it off, since nothing scores above 1.
const THRESHOLD = Number(process.env.HABIT_SIMILARITY || 0.85);
const LOOKBACK = 8;
// Embeddings of very short sentences, like "What's your deal?", scored all over the
// place, so they're never judged.
const MIN_WORDS = 3;
const MAX_CACHED = 500;

const cache = new Map();
let warned = false;

const SENTENCE_END = /(?<=[.!?…])\s+/;
const wordCount = (sentence) => sentence.split(/\s+/).filter((word) => /[a-z]/i.test(word)).length;
// The name the bot adds in code (maybeAddName) isn't something she chose to say.
const withoutName = (reply) => reply.replace(/,? Nine(?=[.!?…"”']*$)/, '');

async function vectorsFor(sentences) {
  const missing = [...new Set(sentences.filter((sentence) => !cache.has(sentence)))];
  if (missing.length > 0) {
    const vectors = await embedBatch(missing);
    missing.forEach((sentence, i) => cache.set(sentence, vectors[i]));
    while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value);
  }
  return sentences.map((sentence) => cache.get(sentence));
}

// Cuts the sentences that mean what she said in her last few replies. If the reply
// opens on one, returns '' so it gets another try, as dropHabits does. keepFirst is for
// answers the prompt dictates. If the embedding can't be had, the reply goes as it is:
// this is a nicety, and must never cost them an answer.
export async function dropSimilarSentences(reply, earlierReplies, { keepFirst = false } = {}) {
  if (THRESHOLD >= 1) return reply;
  const sentences = reply.split(SENTENCE_END);
  const judged = sentences.filter((sentence) => wordCount(sentence) >= MIN_WORDS);
  const earlier = [...new Set(earlierReplies)]
    .slice(-LOOKBACK)
    .flatMap((earlierReply) => withoutName(earlierReply).split(SENTENCE_END))
    .filter((sentence) => wordCount(sentence) >= MIN_WORDS);
  if (judged.length === 0 || earlier.length === 0) return reply;

  let vectors;
  try {
    vectors = await vectorsFor([...judged, ...earlier]);
  } catch (error) {
    if (!warned)
      console.warn(
        '⚠️  Could not compare replies by meaning, so only exact wording is checked:',
        error.message
      );
    warned = true;
    return reply;
  }
  const earlierVectors = vectors.slice(judged.length);
  const repeats = new Set(
    judged.filter((sentence, i) =>
      earlierVectors.some((vector) => cosineSimilarity(vectors[i], vector) >= THRESHOLD)
    )
  );

  const [first, ...rest] = sentences;
  if (!keepFirst && repeats.has(first)) return '';
  return [first, ...rest.filter((sentence) => !repeats.has(sentence))].join(' ');
}
