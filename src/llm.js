/**
 * One place that talks to Ollama's chat endpoint — used by the bot
 * (messageCreate.js, memory.js) and scripts/eval-prompts.js.
 */

import { character } from './character.js';
import { OLLAMA_KEEP_ALIVE, OLLAMA_URL } from './ollama.js';
import { isHarmfulReply, SELF_HARM_CHECK, SELF_HARM_SCHEMA } from './safety.js';
import { dropSimilarSentences } from './similarity.js';

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

const JSON_MAX_TOKENS = 120;

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
// A run of this many words, in one of her last few replies, counts as a habit.
const PHRASE_WORDS = 3;
const PHRASE_LOOKBACK = 8;
// How many replies she has to go between bringing up Captain unprompted.
const CAPTAIN_LOOKBACK = 4;
const CAPTAIN = /\b(?:captain|cap['’]?n|kakeru)\b/i;
// "Whatever, Cap'n." Captain is Kakeru, and whoever she's talking to is Nine.
const CALLS_THEM_CAPTAIN = /,\s*(?:captain|cap['’]?n)\s*(?:[.!?…,]|$)/i;
// How many of her latest replies the model gets to see.
const RECENT_EXCHANGES = 3;

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
  const shared = [...setA].filter((word) => setB.has(word)).length;
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
    .map((sentence) => wordsOf(sentence).join(' '))
    .some(
      (sentence) => sentence.split(' ').length >= MIN_COPIED_WORDS && promptWords.includes(sentence)
    );
}

function phrasesOf(text) {
  const words = wordsOf(text);
  return words
    .slice(0, Math.max(0, words.length - PHRASE_WORDS + 1))
    .map((_, i) => words.slice(i, i + PHRASE_WORDS).join(' '));
}

// Whether Captain is fair game: they named him, asked who, or said "he" right after she
// brought him up. "My boss... he does this every week" doesn't count.
function captainFits(theirWords, lastReply) {
  const last = theirWords.at(-1);
  return (
    theirWords.some((words) => CAPTAIN.test(words)) ||
    /^(?:\w+\s+)?who\b/i.test(last) ||
    (/\b(?:he|him|his)\b/i.test(last) && CAPTAIN.test(lastReply))
  );
}

// Whole-reply overlap can't see her settling into a habit: "You wanna fight, say so.
// Otherwise, shut up." and "Cap'n don't do cringe. Otherwise, shut up." are different
// replies, and that tail is what people notice. A habit here is a sentence that reuses
// a recent phrase, calls them Captain, or brings him up again when she only just did.
// Those get cut from the end of the reply. If it opens on one, returns '' and it needs
// another try, because the answer is usually up front: cutting it left stray tails
// like "Dumbass." Answers the prompt dictates (mustAnswer) always keep their opening,
// and can name Captain as often as they need to.
function dropHabits(reply, earlierReplies, theirWords, mustAnswer) {
  const recent = [...new Set(earlierReplies)];
  const usedPhrases = new Set(recent.slice(-PHRASE_LOOKBACK).flatMap(phrasesOf));
  const captainTooSoon =
    !mustAnswer &&
    !captainFits(theirWords, recent.at(-1) ?? '') &&
    recent.slice(-CAPTAIN_LOOKBACK).some((earlier) => CAPTAIN.test(earlier));
  const isHabit = (sentence) =>
    CALLS_THEM_CAPTAIN.test(sentence) ||
    phrasesOf(sentence).some((phrase) => usedPhrases.has(phrase)) ||
    (captainTooSoon && CAPTAIN.test(sentence));

  const [first, ...rest] = reply.split(/(?<=[.!?…])\s+/);
  if (!mustAnswer && isHabit(first)) return '';
  return [first, ...rest.filter((sentence) => !isHabit(sentence))].join(' ');
}

// How much a reply repeats what she's already said, from 0 (new) to 1 (a copy).
function staleness(reply, earlierReplies, promptWords) {
  if (copiesPrompt(reply, promptWords)) return 1;

  const closest = Math.max(0, ...earlierReplies.map((earlier) => overlap(reply, earlier)));
  // "7" has no words to open on, and that doesn't make it the same as the last "7".
  const start = opener(reply);
  const sameOpener =
    start && earlierReplies.slice(-OPENER_LOOKBACK).some((e) => opener(e) === start);
  return sameOpener ? Math.max(closest, SAME_REPLY_OVERLAP) : closest;
}

// Where in history the turns sent to the model start. She picks up the habits of
// whatever replies she can see, so a conversation that started badly stayed bad:
// with one channel's history she brought up Captain in 11 of 12 replies, and with
// none in 4 of 12. Whole exchanges, because her replies going missing leaves a pile of
// unanswered messages and she answers the old ones. Their older messages still reach
// her, through the prompt (see buildSystemPrompt).
export function recentStart(history) {
  let replies = 0;
  for (let i = history.length - 1; i > 0; i--) {
    if (history[i].role === 'assistant' && ++replies === RECENT_EXCHANGES) {
      while (i > 0 && history[i - 1].role === 'user') i--;
      return i;
    }
  }
  return 0;
}

// chat(), but tries again if she repeats herself or copies a line from the prompt,
// and never sends one telling them to harm themselves. Sampling alone only makes that
// less likely: on a message like "haha ok" she'd re-send an earlier reply whole.
// pastReplies can reach further back than the messages sent to the model. If every try
// repeats, sends the least repetitive.
// factual turns the repetition penalty off: it covers the end of the prompt, so it
// was steering her away from the very names and words in the fact cards.
// scripted means the prompt tells her what to say to this one (a situation's hint).
// gentle is for someone hurting: it leaves her words alone and keeps what they told
// her in front of her on a retry, since that's all that prompt has to go on.
// onToken only covers the first try: a retry's text arrives whole, replacing it.
export async function chatFresh(
  messages,
  {
    model = OLLAMA_MODEL,
    pastReplies = [],
    factual = false,
    scripted = false,
    gentle = false,
    onToken = null,
  } = {}
) {
  const earlierReplies = [
    ...pastReplies,
    ...messages.filter((m) => m.role === 'assistant').map((m) => m.content),
  ];
  const promptWords = wordsOf(messages[0].content).join(' ');
  const theirWords = messages
    .filter((m) => m.role === 'user')
    .slice(-2)
    .map((m) => m.content);

  // Each retry sees less of what she's said: first only the last exchange, so "does it
  // hurt?" still means something, then only their message. Quoting the reply she'd just
  // given and asking for "nothing like" it made things worse: 32 of 42 retries sent that
  // same reply back word for word, because it was the last thing she'd read.
  const lastExchange = messages.slice(1).slice(-3);
  while (lastExchange[0]?.role === 'assistant') lastExchange.shift();
  const attempts = gentle
    ? [messages, messages, messages]
    : [messages, [messages[0], ...lastExchange], [messages[0], messages.at(-1)]];

  let best = null;
  let bestScore = Infinity;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const temperature = SAMPLING.temperature + attempt * RETRY_TEMPERATURE_STEP;
    const raw = await chat(
      attempts[attempt],
      model,
      temperature,
      factual ? 1 : SAMPLING.repeat_penalty,
      attempt === 0 ? onToken : null
    );
    if (isHarmfulReply(raw)) continue;

    const mustAnswer = factual || scripted;
    let kept = gentle ? raw : dropHabits(raw, earlierReplies, theirWords, mustAnswer);
    if (kept && !gentle)
      kept = await dropSimilarSentences(kept, earlierReplies, { keepFirst: mustAnswer });
    const reply = kept || raw;
    const score = kept
      ? staleness(reply, earlierReplies, promptWords)
      : Math.max(staleness(reply, earlierReplies, promptWords), SAME_REPLY_OVERLAP);
    if (score < SAME_REPLY_OVERLAP) {
      if (await encouragesSelfHarm(messages.at(-1).content, reply)) continue;
      return reply;
    }
    if (score < bestScore) {
      best = reply;
      bestScore = score;
    }
  }
  if (best && !(await encouragesSelfHarm(messages.at(-1).content, best))) return best;
  return character.fallbackReply;
}

// REPLY_CHECK=false skips asking the model, leaving only the keywords. It adds about a
// quarter of a second to each reply.
export const REPLY_CHECK = process.env.REPLY_CHECK !== 'false';
let checkWarned = false;

// The yes/no question in safety.js, asked about the reply that's about to be sent. If it
// can't be asked, the keyword check alone stands, and she still answers.
async function encouragesSelfHarm(theirMessage, reply) {
  if (!REPLY_CHECK) return false;
  try {
    const { self_harm } = await chatJson(
      [
        { role: 'system', content: SELF_HARM_CHECK },
        { role: 'user', content: `Their message: ${theirMessage}\nThe reply: ${reply}` },
      ],
      SELF_HARM_SCHEMA
    );
    return self_harm === true;
  } catch (error) {
    if (!checkWarned)
      console.warn(
        '⚠️  Could not check a reply for self-harm, so only the keywords were checked:',
        error.message
      );
    checkWarned = true;
    return false;
  }
}

// For the model as a tool, not as her: a JSON answer matching schema, with no
// randomness. Same num_ctx as chat(), since a different one makes Ollama reload
// the model, which would stall the next reply.
export async function chatJson(messages, schema, model = OLLAMA_MODEL) {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      think: false,
      format: schema,
      keep_alive: OLLAMA_KEEP_ALIVE,
      options: { temperature: 0, num_ctx: OLLAMA_NUM_CTX, num_predict: JSON_MAX_TOKENS },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama returned HTTP ${response.status}`);
  }

  const data = await response.json();
  return JSON.parse(data.message?.content ?? '{}');
}

// Loads the chat model now, so the first person to talk to her doesn't wait for it.
// Same context size as chat(), since a different one makes Ollama load it all over
// again. An empty conversation only loads the model.
export async function warmUp() {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [],
      keep_alive: OLLAMA_KEEP_ALIVE,
      options: { num_ctx: OLLAMA_NUM_CTX },
    }),
  });
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
  await response.json();
}

// messages: [{ role: 'system' | 'user' | 'assistant', content }]
// onToken, if given, is called with the reply so far as it's written.
async function chat(messages, model, temperature, repeatPenalty, onToken) {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: Boolean(onToken),
      think: OLLAMA_THINK,
      keep_alive: OLLAMA_KEEP_ALIVE,
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

  const data = onToken ? await readStream(response, onToken) : await response.json();
  const reply = data.message?.content?.trim();

  if (!reply) throw new Error('Empty response from Ollama');
  return data.done_reason === 'length' ? trimToLastSentence(reply) : reply;
}

// Ollama streams one JSON object per line. Returns the same shape as a normal reply.
async function readStream(response, onToken) {
  const decoder = new TextDecoder();
  let buffered = '';
  let content = '';
  let doneReason = null;

  const readLine = (line) => {
    const part = JSON.parse(line);
    if (part.done) doneReason = part.done_reason;
    if (part.message?.content) {
      content += part.message.content;
      onToken(content);
    }
  };

  for await (const chunk of response.body) {
    buffered += decoder.decode(chunk, { stream: true });
    const lines = buffered.split('\n');
    buffered = lines.pop();
    lines.filter(Boolean).forEach(readLine);
  }
  if (buffered.trim()) readLine(buffered);

  return { message: { content }, done_reason: doneReason };
}
