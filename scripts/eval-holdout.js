#!/usr/bin/env node
/**
 * Tests one or two models on her lines they never trained on (data/holdout.jsonl, and
 * its Discord-style version if there is one), scored by a model acting as judge. Her
 * real lines are scored the same way, as the yardstick.
 *
 * Unlike `npm run eval`, this leaves out scenes, fact cards and the full persona: every
 * model gets the short training prompt, so differences come from the model. RAG would
 * also hand them the very lines being tested, since the index has every script.
 *
 * A judge only means something if it can tell good from bad, so each run first checks
 * that on replies whose answer is already known, and says if it can't. qwen3:8b rates
 * nearly everything 5, including her lines put in the wrong place (4.58 against 4.67)
 * and itself above her real ones, so head to head is the number to read: choosing
 * between two replies is something it can do. Scores only catch the plainly broken.
 *
 * Usage: node scripts/eval-holdout.js [modelA] [modelB] [--judge NAME] [--limit N]
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { character } from '../src/character.js';
import { chatFresh, chatJson } from '../src/llm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const EVAL_DIR = join(DATA_DIR, 'evals');
const SETS = [
  { name: 'script scenes', path: join(DATA_DIR, 'holdout.jsonl') },
  { name: 'Discord-style', path: join(DATA_DIR, 'synthetic-holdout.jsonl') },
];

const CONTEXT_CHARS = 1500; // what the judge sees of what led up to the reply
const CHECK_ROWS = 20;
// How often it has to pick her real line in the known-answer check, or don't trust it.
const MIN_PICKS_OVER_WRONG_VOICE = 0.9;
const MIN_PICKS_OVER_WRONG_PLACE = 0.7;

// Fine replies from the wrong person, to check the judge notices.
const WRONG_VOICE = [
  "Sure! I'd be happy to help you with that. Let me know if you need anything else.",
  'That sounds wonderful! I hope you have a lovely day, and please take care of yourself.',
  'As an AI language model, I do not have personal feelings, but I can offer some suggestions.',
  'Oh my, you are so sweet! Thank you ever so much for thinking of me, it means a lot.',
];

const SCORE = { type: 'integer', enum: [1, 2, 3, 4, 5] };
const SCORE_SCHEMA = {
  type: 'object',
  properties: { voice: SCORE, in_character: SCORE },
  required: ['voice', 'in_character'],
};
const PAIR_SCHEMA = {
  type: 'object',
  properties: { better: { type: 'string', enum: ['A', 'B'] } },
  required: ['better'],
};

const JUDGE_BRIEF = `You judge replies written for a fictional character. Here is her character sheet.

<character>
${character.trainingPrompt}
</character>`;

const SCORE_PROMPT = `${JUDGE_BRIEF}

Score the reply from 1 to 5 on each of these. Be strict: 3 is ordinary, and 5 is rare.
- voice: does it sound like her? Crude, short, punchy and casual is high. Polite, warm, flowery or wordy is low.
- in_character: does she stay herself? Sounding like an assistant, mentioning being an AI, or offering help cheerfully is 1.`;

const PAIR_PROMPT = `${JUDGE_BRIEF}

You get what was said, and two replies. Pick the one that sounds more like her and responds better to what was said.`;

// Mistakes that need no judge.
const RULES = {
  // The judge gave these replies 5 out of 5 for her voice.
  'shows its thinking': reply => /<\/?think>/i.test(reply),
  'sounds like an AI': reply => /\b(?:as an ai|language model|i'm an ai|i am an ai)\b/i.test(reply),
  'assistant phrases': reply => /\b(?:happy to help|how can i help|let me know if|feel free to)\b/i.test(reply),
  'starts with a name or quote': reply => /^(?:ghost|lena)\s*:|^["“]/i.test(reply),
  'calls them Captain': reply => /(?:^|[.!?,]\s*)cap(?:tain|'n)\s*[,!?]|,\s*cap(?:tain|'n)\s*[.!?]/i.test(reply),
  'spoiler name': reply => new RegExp(character.spoilerNames.source, 'i').test(reply),
  'not English': reply => /[\u3040-\u30ff\u4e00-\u9fff]/.test(reply),
};

function parseArgs() {
  const args = process.argv.slice(2);
  const take = name => {
    const index = args.indexOf(name);
    return index >= 0 ? args.splice(index, 2)[1] : undefined;
  };
  const judge = take('--judge');
  const limit = Number(take('--limit')) || Infinity;
  const models = args.length > 0 ? args : [process.env.OLLAMA_MODEL || 'qwen3:8b'];
  if (models.length > 2) {
    console.error('❌ One or two models at a time.');
    process.exit(1);
  }
  return { models, judge: judge ?? process.env.OLLAMA_MODEL ?? 'qwen3:8b', limit };
}

function readSet({ name, path }, limit) {
  if (!existsSync(path)) return null;
  const rows = readFileSync(path, 'utf-8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  return { name, rows: rows.slice(0, limit) };
}

function conversation(row) {
  return row.messages.filter(m => m.role !== 'system').slice(0, -1);
}

function contextText(row) {
  return conversation(row)
    .map(m => (m.role === 'assistant' ? `Ghost: ${m.content}` : m.content))
    .join('\n')
    .slice(-CONTEXT_CHARS);
}

function realReply(row) {
  return row.messages.at(-1).content;
}

// Returns null if the judge's answer can't be read, which gets counted in the report.
async function score(judge, row, reply) {
  try {
    return await chatJson(
      [
        { role: 'system', content: SCORE_PROMPT },
        { role: 'user', content: `What was said:\n${contextText(row)}\n\nThe reply:\n${reply}` },
      ],
      SCORE_SCHEMA,
      judge
    );
  } catch {
    return null;
  }
}

// Which side each reply goes on follows the row's position, so across a set each model
// is shown first about half the time, and any taste for "A" cancels out.
async function compare(judge, row, index, replyOne, replyTwo) {
  const flipped = index % 2 === 1;
  const [a, b] = flipped ? [replyTwo, replyOne] : [replyOne, replyTwo];
  try {
    const { better } = await chatJson(
      [
        { role: 'system', content: PAIR_PROMPT },
        { role: 'user', content: `What was said:\n${contextText(row)}\n\nReply A:\n${a}\n\nReply B:\n${b}` },
      ],
      PAIR_SCHEMA,
      judge
    );
    if (better !== 'A' && better !== 'B') return null;
    return (better === 'A') !== flipped ? 0 : 1;
  } catch {
    return null;
  }
}

function mean(values) {
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : NaN;
}

function averages(scores) {
  const read = scores.filter(Boolean);
  return {
    voice: mean(read.map(s => s.voice)),
    inCharacter: mean(read.map(s => s.in_character)),
    unread: scores.length - read.length,
  };
}

// Two-sided exact sign test: how often a coin would split this unevenly.
function signTest(wins, losses) {
  const n = wins + losses;
  if (n === 0) return 1;
  let tail = 0;
  let term = 0.5 ** n;
  for (let k = 0; k <= Math.min(wins, losses); k++) {
    tail += term;
    term *= (n - k) / (k + 1);
  }
  return Math.min(1, 2 * tail);
}

// Can it pick her line over someone else's voice, and over her own line from elsewhere?
async function checkJudge(judge, rows) {
  const sample = rows.slice(0, CHECK_ROWS);
  const picks = { wrongVoice: 0, wrongPlace: 0 };
  for (const [i, row] of sample.entries()) {
    const real = realReply(row);
    const elsewhere = realReply(sample[(i + Math.floor(sample.length / 2)) % sample.length]);
    if ((await compare(judge, row, i, real, WRONG_VOICE[i % WRONG_VOICE.length])) === 0) picks.wrongVoice++;
    if ((await compare(judge, row, i, real, elsewhere)) === 0) picks.wrongPlace++;
  }
  return { ...picks, total: sample.length };
}

async function runSet(set, models, judge) {
  const labels = models.length === 2 && models[0] === models[1] ? [`${models[0]} (1)`, `${models[1]} (2)`] : models;
  const results = set.rows.map(row => ({ row, replies: [], scores: [], pair: null }));

  for (const [m, model] of models.entries()) {
    for (const [i, result] of results.entries()) {
      const messages = [{ role: 'system', content: character.trainingPrompt }, ...conversation(result.row)];
      result.replies[m] = await chatFresh(messages, { model });
      if ((i + 1) % 20 === 0) console.log(`  ${set.name}: ${labels[m]} ${i + 1}/${results.length}`);
    }
  }

  for (const [i, result] of results.entries()) {
    for (const m of models.keys()) result.scores[m] = await score(judge, result.row, result.replies[m]);
    result.realScore = await score(judge, result.row, realReply(result.row));
    if (models.length === 2) result.pair = await compare(judge, result.row, i, result.replies[0], result.replies[1]);
    if ((i + 1) % 20 === 0) console.log(`  ${set.name}: judged ${i + 1}/${results.length}`);
  }

  const summaries = labels.map((label, m) => ({
    label,
    ...averages(results.map(r => r.scores[m])),
    words: mean(results.map(r => r.replies[m].split(/\s+/).length)),
    broken: Object.entries(RULES)
      .map(([rule, breaks]) => [rule, results.filter(r => breaks(r.replies[m])).length])
      .filter(([, count]) => count > 0),
  }));
  summaries.push({
    label: 'her real lines',
    ...averages(results.map(r => r.realScore)),
    words: mean(results.map(r => realReply(r.row).split(/\s+/).length)),
    broken: [],
  });

  const head = results.map(r => r.pair);
  const headToHead =
    models.length === 2
      ? {
          wins: [head.filter(p => p === 0).length, head.filter(p => p === 1).length],
          unread: head.filter(p => p === null).length,
        }
      : null;
  if (headToHead) headToHead.p = signTest(...headToHead.wins);

  return { name: set.name, labels, results, summaries, headToHead };
}

const number = value => (Number.isNaN(value) ? '-' : value.toFixed(2));

function summaryTable(run) {
  const lines = [
    '| | voice | in character | words | rules broken |',
    '| --- | --- | --- | --- | --- |',
    ...run.summaries.map(
      s =>
        `| ${s.label} | ${number(s.voice)} | ${number(s.inCharacter)} | ${s.words.toFixed(1)} | ${
          s.broken.map(([rule, count]) => `${rule}: ${count}`).join(', ') || 'none'
        } |`
    ),
  ];
  if (run.headToHead) {
    const { wins, unread, p } = run.headToHead;
    lines.push(
      '',
      `Head to head: ${run.labels[0]} ${wins[0]}, ${run.labels[1]} ${wins[1]} (p=${p.toFixed(3)}${unread ? `, ${unread} unread` : ''}).`
    );
  }
  return lines.join('\n');
}

function checkSummary({ wrongVoice, wrongPlace, total }) {
  return [
    `Picked her line over someone else's voice: ${wrongVoice}/${total}`,
    `Picked her line over her own line from elsewhere: ${wrongPlace}/${total}`,
  ].join('\n');
}

function transcript(run) {
  return run.results
    .map(({ row, replies, scores, realScore }) => {
      const scoreText = s => (s ? `voice ${s.voice}, in character ${s.in_character}` : 'unread');
      const quote = text => text.replace(/\n/g, '\n> ');
      return [
        `### ${row.source ?? ''}`,
        `> ${quote(contextText(row).slice(-400))}`,
        '',
        ...run.labels.flatMap((label, m) => [`**${label}** (${scoreText(scores[m])})`, `> ${quote(replies[m])}`, '']),
        `**her real line** (${scoreText(realScore)})`,
        `> ${quote(realReply(row))}`,
      ].join('\n');
    })
    .join('\n\n');
}

function timestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

async function main() {
  const { models, judge, limit } = parseArgs();
  const sets = SETS.map(set => readSet(set, limit)).filter(Boolean);
  if (sets.length === 0) {
    console.error('❌ No held-out data. Run `npm run export:script` first.');
    process.exit(1);
  }

  console.log(`🧪 Testing ${models.join(' vs ')}, judged by "${judge}".`);
  if (models.includes(judge)) {
    console.log('   The judge is also being tested, so it may favour how it writes itself.');
  }

  console.log('\n⚖️  Checking the judge on replies with known answers...');
  const check = await checkJudge(judge, sets[0].rows);
  console.log(checkSummary(check));
  const warning =
    check.wrongVoice / check.total < MIN_PICKS_OVER_WRONG_VOICE
      ? `⚠️  This judge can't reliably tell her voice from someone else's, so don't read much into head to head. Try a bigger one with --judge, and read the replies.`
      : check.wrongPlace / check.total < MIN_PICKS_OVER_WRONG_PLACE
        ? `⚠️  This judge can tell voices apart but not whether a reply fits, so head to head only speaks to voice. Read the replies to see whether they make sense.`
        : '';
  if (warning) console.warn(`\n${warning}`);

  const runs = [];
  for (const set of sets) {
    console.log(`\n📋 ${set.name}: ${set.rows.length} example(s)`);
    const run = await runSet(set, models, judge);
    console.log(summaryTable(run));
    runs.push(run);
  }

  if (!existsSync(EVAL_DIR)) mkdirSync(EVAL_DIR, { recursive: true });
  const name = models.map(m => m.replace(/[^\w.-]+/g, '_')).join('-vs-');
  const outPath = join(EVAL_DIR, `holdout-${name}-${timestamp()}.md`);
  writeFileSync(
    outPath,
    [
      `# Hold-out eval: ${models.join(' vs ')}`,
      `${new Date().toISOString()} · judged by ${judge}`,
      warning,
      `## Judge check\n\n\`\`\`\n${checkSummary(check)}\n\`\`\``,
      ...runs.flatMap(run => [`## ${run.name}\n\n${summaryTable(run)}`]),
      ...runs.flatMap(run => [`## Replies: ${run.name}\n\n${transcript(run)}`]),
    ]
      .filter(Boolean)
      .join('\n\n')
  );
  console.log(`\n✅ Saved the scores and every reply to ${outPath}`);
}

main().catch(error => {
  console.error('❌ Eval failed:', error.message);
  process.exit(1);
});
