/**
 * One place that talks to Ollama's chat endpoint — used by the bot
 * (messageCreate.js) and scripts/eval-prompts.js.
 */

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3:8b';

// Qwen3 "thinks" before answering unless told not to — slow, and pointless
// for casual chat. OLLAMA_THINK=true turns it back on.
const OLLAMA_THINK = process.env.OLLAMA_THINK === 'true';

// Room for the persona + script references + history, with headroom to raise
// RAG_TOP_K or MAX_HISTORY. Ollama's default is small enough that it would
// silently drop content. 16384 uses about 7.5 GB of VRAM on qwen3:8b.
const OLLAMA_NUM_CTX = Number(process.env.OLLAMA_NUM_CTX || 16384);

// Hard limit on reply length, roughly 65 words. Prompt rules alone didn't stop
// the model writing essays when asked. Thinking uses up the same budget, so the
// limit only applies with thinking off.
const OLLAMA_MAX_REPLY_TOKENS = Number(process.env.OLLAMA_MAX_REPLY_TOKENS || 90);

// How the model picks words. qwen3:8b ships tuned for accuracy (temperature 0.6,
// top_k 20, no repetition penalty at all), and she repeated herself within a few
// messages. repeat_last_n has to reach back over her recent replies to help.
const SAMPLING = {
  temperature: Number(process.env.OLLAMA_TEMPERATURE || 0.85),
  top_k: Number(process.env.OLLAMA_TOP_K || 40),
  top_p: Number(process.env.OLLAMA_TOP_P || 0.95),
  repeat_penalty: Number(process.env.OLLAMA_REPEAT_PENALTY || 1.15),
  repeat_last_n: Number(process.env.OLLAMA_REPEAT_LAST_N || 256),
};

// chatFresh: how many tries, and how much hotter each retry runs.
const MAX_ATTEMPTS = 3;
const RETRY_TEMPERATURE_STEP = 0.1;
// Two replies sharing this much of their vocabulary count as the same reply.
const SAME_REPLY_OVERLAP = 0.6;
// A reply also counts as repeating if it opens like one of her last few.
const OPENER_LOOKBACK = 3;
// A sentence this long, found word for word in the prompt, counts as copied.
const MIN_COPIED_WORDS = 4;

// A reply cut off at the limit would end mid-sentence, so end it at the last
// complete one. Left alone if it has none.
function trimToLastSentence(text) {
  return text.match(/^[\s\S]*[.!?…]["”']?(?=\s|$)/)?.[0] ?? text;
}

function wordsOf(text) {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'") // the model often writes curly apostrophes
    .replace(/[^a-z' ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function overlap(a, b) {
  const setA = new Set(wordsOf(a));
  const setB = new Set(wordsOf(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  const shared = [...setA].filter(word => setB.has(word)).length;
  return shared / (setA.size + setB.size - shared);
}

function opener(text) {
  return wordsOf(text).slice(0, 2).join(' ');
}

// True if a sentence of the reply appears word for word in the prompt: a voice
// line, a memory, or a line from a retrieved scene.
function copiesPrompt(reply, promptWords) {
  return reply
    .split(/(?<=[.!?…])\s+/)
    .map(sentence => wordsOf(sentence).join(' '))
    .some(sentence => sentence.split(' ').length >= MIN_COPIED_WORDS && promptWords.includes(sentence));
}

// How much a reply repeats what she's already said, from 0 (new) to 1 (a copy).
function staleness(reply, earlierReplies, promptWords) {
  if (copiesPrompt(reply, promptWords)) return 1;

  const closest = Math.max(0, ...earlierReplies.map(earlier => overlap(reply, earlier)));
  const sameOpener = earlierReplies.slice(-OPENER_LOOKBACK).some(e => opener(e) === opener(reply));
  return sameOpener ? Math.max(closest, SAME_REPLY_OVERLAP) : closest;
}

// chat(), but tries again if she repeats herself or copies a line from the prompt.
// Sampling alone only makes that less likely: on a message like "haha ok" she'd
// re-send an earlier reply whole. pastReplies can reach further back than the
// messages sent to the model. If every try repeats, sends the least repetitive.
// factual turns the repetition penalty off: it covers the end of the prompt, so it
// was steering her away from the very names and words in the fact cards.
export async function chatFresh(messages, { model = OLLAMA_MODEL, pastReplies = [], factual = false } = {}) {
  const earlierReplies = [
    ...pastReplies,
    ...messages.filter(m => m.role === 'assistant').map(m => m.content),
  ];
  const promptWords = wordsOf(messages[0].content).join(' ');

  const [system, ...conversation] = messages;
  let attemptMessages = messages;
  let best = null;
  let bestScore = Infinity;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const temperature = SAMPLING.temperature + attempt * RETRY_TEMPERATURE_STEP;
    const reply = await chat(attemptMessages, model, temperature, factual ? 1 : SAMPLING.repeat_penalty);
    const score = staleness(reply, earlierReplies, promptWords);
    if (score < SAME_REPLY_OVERLAP) return reply;
    if (score < bestScore) {
      best = reply;
      bestScore = score;
    }
    // Different dice alone won't shift an answer the model really likes.
    attemptMessages = [
      { ...system, content: `${system.content}\n\nReply to them in fresh words, nothing like: ${reply}` },
      ...conversation,
    ];
  }
  return best;
}

// messages: [{ role: 'system' | 'user' | 'assistant', content }]
export async function chat(
  messages,
  model = OLLAMA_MODEL,
  temperature = SAMPLING.temperature,
  repeatPenalty = SAMPLING.repeat_penalty,
) {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      think: OLLAMA_THINK,
      options: {
        ...SAMPLING,
        temperature,
        repeat_penalty: repeatPenalty,
        num_ctx: OLLAMA_NUM_CTX,
        ...(OLLAMA_THINK ? {} : { num_predict: OLLAMA_MAX_REPLY_TOKENS }),
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama returned HTTP ${response.status}`);
  }

  const data = await response.json();
  const reply = data.message?.content?.trim();

  if (!reply) throw new Error('Empty response from Ollama');
  return data.done_reason === 'length' ? trimToLastSentence(reply) : reply;
}
