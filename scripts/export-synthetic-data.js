#!/usr/bin/env node
/**
 * Rewrites script examples into Discord-style ones: her real line stays word for word,
 * and a model writes a casual message a stranger could have sent to get it. Script
 * contexts are narration and people she knows, which looks nothing like what she's
 * sent on Discord.
 *
 * The model can't be trusted with what's kept, as in src/memory.js, so the checks here
 * decide. Her lines were said to people in the story, so any naming someone in it go
 * first: paired with a stranger's message, "Hey Captain" would teach her to call people
 * Captain. Anything near grief or a crisis goes too, because a rude line paired with
 * someone's bad day would teach exactly what src/safety.js exists to stop.
 *
 * Then a second call sees only the message and four of her lines, and has to pick the
 * one that follows. Asked to rate a pair instead, the model passed 25 of 33 deliberately
 * mismatched ones, since a rude reply seems to fit anything. A wrong pair can only
 * survive this by luck, about 1 time in 4.
 *
 * Held-out examples are rewritten into their own file, so they stay out of training.
 * Run export:script first.
 *
 * Usage: node scripts/export-synthetic-data.js [--model NAME] [--limit N]
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { character } from '../src/character.js';
import { chatJson } from '../src/llm.js';
import { needsGentleReply } from '../src/safety.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const TRAIN_INPUT = join(DATA_DIR, 'script-training-data.jsonl');
const HOLDOUT_INPUT = join(DATA_DIR, 'holdout.jsonl');
const TRAIN_OUTPUT = join(DATA_DIR, 'synthetic-training-data.jsonl');
const HOLDOUT_OUTPUT = join(DATA_DIR, 'synthetic-holdout.jsonl');

const CONTEXT_CHARS = 800; // what led up to her line; the rest only slows the model down
const MAX_MESSAGE_WORDS = 25;
const MAX_REPLY_OVERLAP = 0.5;
const MIN_REPLY_WORDS = 3;
const MAX_REPLY_WORDS = 40;
const MAX_ECHO = 0.5; // how much of her line's longer words the message can already contain

// About someone in the scene: "She's dumping 'em all in" needs you to see her.
const ABOUT_SOMEONE_THERE = /\b(?:she|she's|her|hers|he|he's|him|his|this guy|that guy|this girl|that girl)\b/i;

// Left to itself, nearly every message opened "bro" or "you think". Rotating the first
// word is what fixed it: asking for variety didn't.
const OPENERS = ['why', 'ok', 'so', 'lol', 'can', 'im', 'wait', 'hey', 'nah', 'what', 'you', 'just', 'how', 'dude', 'i', 'do'];

// Lines for someone else in the scene, not for one stranger.
const SPEAKS_TO_A_GROUP = /\b(?:you two|you both|you guys|u guys|y'?all|you all|all of you|you people)\b/i;

const STORY_WORDS =
  /\b(?:captain|cap'n|kakeru|niimi|haruka|kosaka|empress|your highness|renya|takamine|commander|sora|miyako|kujo|noa|yuuki|sophie|sophitia|naruse|satsuki|onii-chan|artifacts?|stigmas?|valhalla|rig veda|sephirot)\b/i;

// spoilerNames is written for script text. These messages are all lowercase.
const SPOILERS = new RegExp(character.spoilerNames.source, 'i');

// Her line stops mid-word, because someone interrupted her in the scene.
const CUT_OFF = /[—–-]["”]?\s*$/;

const SEXUAL =
  /\b(?:bitch\w*|pussy|slut\w*|whore\w*|sex\w*|boobs?|breasts?|tits?|titties|chest|rack|cleavage|melons|naked|nude|undress\w*|strip\w*|horny|virgin|underwear|panties|bra|lingerie|porn\w*|perv\w*|flirt\w*|kiss\w*|grop\w*|hot girl|hottie|sexy|figure|curves?|thighs?|butt)\b/i;

// Softer than src/safety.js on purpose: this only costs a training example.
const HEAVY =
  /\b(?:die|dies|died|dead|death|dying|kill\w*|suicid\w*|funeral|grie\w*|depress\w*|cry\w*|crying|sad|lonely|alone|hurt\w*|scared|afraid|hopeless|worthless|hate myself|sorry for|parents?|mom|mum|dad|mother|father|family)\b/i;

const REWRITE_PROMPT = `You write practice data for a chatbot. You get the end of a story scene, and the line a rude, tough girl named Ghost said next. Write the one casual Discord message a stranger could have sent her, so that her line works as a natural reply to it.

Rules for the message:
- Lowercase and short, the way people really type on Discord. Under 20 words.
- It's said to her directly, one person talking to one person. Teasing, bragging, asking, complaining or daring are all good.
- It must make sense to someone who doesn't know the story. No story names.
- It's what they typed: no narration, no speaker names, no quote marks.
- Don't repeat her line, or give away what she says.
- Nothing personal: no family, health or feelings, nothing about death, grief or self-harm, and nothing sexual.

If her line only makes sense inside that scene, set works to false.

Examples:
Scene: Mina: "I can't carry all of these." | Her line: Tch. Give me half, then. -> {"works":true,"message":"these boxes weigh a ton, little help?"}
Scene: (narration): He lit the match. | Her line: Don't even think about it. -> {"works":true,"message":"im about to do something really dumb lol"}
Scene: Tomo: "The key's under the third stone." | Her line: Third stone, huh. Got it. -> {"works":false,"message":""}`;

const REWRITE_SCHEMA = {
  type: 'object',
  properties: { works: { type: 'boolean' }, message: { type: 'string' } },
  required: ['works', 'message'],
};

const PICK_PROMPT = `Someone sent a Discord message, and you see four possible replies, all rude. Exactly one of them was written as the response to that message. Going only by what the message says, pick the reply that responds to it most directly.`;

const PICK_LETTERS = ['A', 'B', 'C', 'D'];

const PICK_SCHEMA = {
  type: 'object',
  properties: { pick: { type: 'string', enum: PICK_LETTERS } },
  required: ['pick'],
};

function flag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readRows(path) {
  return readFileSync(path, 'utf-8').split('\n').filter(Boolean).map(line => JSON.parse(line));
}

function wordsOf(text) {
  return new Set(text.toLowerCase().replace(/[’‘]/g, "'").match(/[\p{L}\p{N}']+/gu) ?? []);
}

function overlap(a, b) {
  const setA = wordsOf(a);
  const setB = wordsOf(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  const shared = [...setA].filter(word => setB.has(word)).length;
  return shared / (setA.size + setB.size - shared);
}

// Why her line can't be used, before asking the model anything. Null if it's fine.
function replyProblem(reply) {
  if (STORY_WORDS.test(reply)) return 'her line names something in the story';
  if (CUT_OFF.test(reply)) return 'her line is cut off';
  if (reply.split(/\s+/).length < MIN_REPLY_WORDS) return 'her line is too short to answer anything';
  if (reply.split(/\s+/).length > MAX_REPLY_WORDS) return 'her line is a speech, not a chat reply';
  if (ABOUT_SOMEONE_THERE.test(reply)) return 'her line is about someone in the scene';
  if (SPOILERS.test(reply)) return 'her line has a spoiler';
  if (SEXUAL.test(reply)) return 'her line has something sexual';
  if (HEAVY.test(reply)) return 'her line is about something heavy';
  return null;
}

// Why the model's message can't be used. Null if it's fine.
function messageProblem(message, reply, seen) {
  if (!message) return 'empty message';
  if (message.split(/\s+/).length > MAX_MESSAGE_WORDS) return 'message too long';
  if (SPEAKS_TO_A_GROUP.test(message)) return 'message talks to a group';
  if (/^[\p{L} .'-]{1,20}:|^["“(*]|\n/u.test(message)) return "doesn't read like something typed";
  if (!/^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]+$/u.test(message)) return 'not English';
  if (needsGentleReply([message]) || HEAVY.test(message)) return 'message is about something heavy';
  if (SEXUAL.test(message)) return 'message has something sexual';
  if (SPOILERS.test(message) || STORY_WORDS.test(message)) return 'message names something in the story';
  if (overlap(message, reply) > MAX_REPLY_OVERLAP) return 'message repeats her line';
  const longWords = [...wordsOf(reply)].filter(word => word.length > 3);
  const messageWords = wordsOf(message);
  if (longWords.length > 0 && longWords.filter(word => messageWords.has(word)).length / longWords.length >= MAX_ECHO) {
    return 'message gives away her line';
  }
  if (seen.has([...wordsOf(message)].sort().join(' '))) return 'duplicate message';
  return null;
}

// Whether the model picks her real line out of it and three others. The others are
// spread evenly through the set, and the real one's position moves with the row.
async function picksHerLine(message, reply, usable, i, model) {
  const others = PICK_LETTERS.slice(1).map((_, k) => usable[(i + (k + 1) * Math.floor(usable.length / 4)) % usable.length]);
  const position = i % PICK_LETTERS.length;
  const candidates = others.filter(other => other !== reply);
  candidates.splice(position, 0, reply);
  const choices = candidates
    .slice(0, PICK_LETTERS.length)
    .map((candidate, k) => `${PICK_LETTERS[k]}: ${candidate.replace(/\s*\n\s*/g, ' ')}`)
    .join('\n');
  const { pick } = await chatJson(
    [
      { role: 'system', content: PICK_PROMPT },
      { role: 'user', content: `Message: ${message}\n\n${choices}` },
    ],
    PICK_SCHEMA,
    model
  );
  return PICK_LETTERS.indexOf(pick) === position;
}

async function rewrite(rows, model, drops) {
  const seen = new Set();
  const kept = [];
  const drop = reason => drops.set(reason, (drops.get(reason) ?? 0) + 1);
  const usable = rows.map(row => row.messages.at(-1).content).filter(reply => !replyProblem(reply));

  for (const [i, row] of rows.entries()) {
    const reply = row.messages.at(-1).content;
    const context = row.messages
      .filter(m => m.role !== 'system')
      .slice(0, -1)
      .map(m => (m.role === 'assistant' ? `Ghost: ${m.content}` : m.content))
      .join('\n')
      .slice(-CONTEXT_CHARS);

    const problem = replyProblem(reply);
    if (problem) {
      drop(problem);
      continue;
    }

    try {
      const { works, message: raw } = await chatJson(
        [
          { role: 'system', content: REWRITE_PROMPT },
          {
            role: 'user',
            content: `Scene:\n${context}\n\nHer line: ${reply}\n\nStart the message with the word "${OPENERS[i % OPENERS.length]}".`,
          },
        ],
        REWRITE_SCHEMA,
        model
      );
      if (!works) {
        drop('model said her line only works in the scene');
        continue;
      }
      const message = String(raw ?? '').trim();
      const rejected = messageProblem(message, reply, seen);
      if (rejected) {
        drop(rejected);
        continue;
      }
      if (!(await picksHerLine(message, reply, usable, i, model))) {
        drop(`model couldn't pick her line out from three others`);
        continue;
      }
      seen.add([...wordsOf(message)].sort().join(' '));
      kept.push({
        ...(row.source ? { source: row.source } : {}),
        messages: [
          { role: 'system', content: character.trainingPrompt },
          { role: 'user', content: message },
          { role: 'assistant', content: reply },
        ],
      });
    } catch (error) {
      drop(`model call failed (${error.message})`);
    }
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${rows.length}, kept ${kept.length}`);
  }
  return kept;
}

async function main() {
  if (!existsSync(TRAIN_INPUT) || !existsSync(HOLDOUT_INPUT)) {
    console.error('❌ Run `npm run export:script` first.');
    process.exit(1);
  }
  const model = flag('--model') || process.env.OLLAMA_MODEL || 'qwen3:8b';
  const limit = Number(flag('--limit')) || Infinity;

  for (const [input, output, label] of [
    [TRAIN_INPUT, TRAIN_OUTPUT, 'training'],
    [HOLDOUT_INPUT, HOLDOUT_OUTPUT, 'held-out'],
  ]) {
    const rows = readRows(input).slice(0, limit);
    console.log(`\n✍️  Rewriting ${rows.length} ${label} example(s) with "${model}"...`);
    const drops = new Map();
    const kept = await rewrite(rows, model, drops);
    if (kept.length === 0 && rows.length > 0) {
      console.error(`❌ Nothing survived: ${JSON.stringify([...drops])}`);
      process.exit(1);
    }
    writeFileSync(output, kept.map(r => JSON.stringify(r)).join('\n'));
    console.log(`✅ Wrote ${kept.length} of ${rows.length} to ${output}`);
    for (const [reason, count] of [...drops].sort((a, b) => b[1] - a[1])) console.log(`   ${count}  ${reason}`);
  }
}

main();
