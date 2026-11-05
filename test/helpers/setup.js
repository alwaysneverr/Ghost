// Every test file imports this first, before anything from src/. It points the bot's
// database, logs and scene index at a fresh temporary folder, and cuts off the network,
// so a test can never touch real data, Discord or Ollama. A test that needs Ollama's
// answers stubs fetch itself (see stubOllama).
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export const TEST_DIR = mkdtempSync(join(tmpdir(), 'ghost-test-'));
process.env.GHOST_DB_PATH = join(TEST_DIR, 'ghost.db');
process.env.GHOST_LOG_DIR = join(TEST_DIR, 'logs');
process.env.RAG_INDEX_PATH = join(TEST_DIR, 'no-index.db');
process.env.OLLAMA_ALERTS = 'false'; // no DMs to anyone; test/stability.test.js turns them on itself

globalThis.fetch = async (url) => {
  throw new Error(`No network in tests: ${url}`);
};

process.on('exit', () => {
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // SQLite may still hold its file open on Windows; it's only a temp folder.
  }
});

// A made-up embedding: the same text always gets the same vector, and different texts
// get unrelated ones, unless sameMeaning says two sentences mean the same thing.
function fakeEmbedding(text, sameMeaning) {
  const key = sameMeaning.find((group) => group.includes(text))?.[0] ?? text;
  let seed = [...key].reduce((hash, ch) => (hash * 31 + ch.charCodeAt(0)) >>> 0, 7);
  return Array.from({ length: 64 }, () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed / 2 ** 32 - 0.5;
  });
}

// Stands in for Ollama. Chat replies come from `replies` in order, then made-up ones
// that share no words, so none of them counts as a repeat. Every chat request is kept
// in `calls`, every embedded text in `embedded`, and every JSON request (the reply
// check, memory) in `jsonCalls`. The reply check answers yes for the replies in
// `selfHarm`.
export function stubOllama(replies = [], { sameMeaning = [], selfHarm = [] } = {}) {
  const queue = [...replies];
  const calls = [];
  const embedded = [];
  const jsonCalls = [];
  const word = () =>
    Array.from({ length: 7 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join(
      ''
    );
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (String(url).endsWith('/api/embed')) {
      const texts = Array.isArray(body.input) ? body.input : [body.input];
      embedded.push(...texts);
      return Response.json({ embeddings: texts.map((text) => fakeEmbedding(text, sameMeaning)) });
    }
    if (body.format) {
      jsonCalls.push(body);
      if (body.format.properties?.self_harm) {
        const asked = body.messages.at(-1).content;
        const flagged = selfHarm.some((reply) => asked.endsWith(`The reply: ${reply}`));
        return Response.json({
          message: { content: JSON.stringify({ self_harm: flagged }) },
          done_reason: 'stop',
        });
      }
      return Response.json({ message: { content: '{"facts":[]}' }, done_reason: 'stop' });
    }
    calls.push(body);
    const content = queue.length > 0 ? queue.shift() : `${word()} ${word()} ${word()} ${word()}.`;
    return Response.json({ message: { content }, done_reason: 'stop' });
  };
  return {
    calls,
    embedded,
    jsonCalls,
    queue: (...more) => queue.push(...more),
  };
}

// Swallows console output while fn runs, and hands it back.
export async function quietly(fn) {
  const lines = [];
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...args) => lines.push(args.join(' '));
  try {
    const result = await fn();
    return { result, lines };
  } finally {
    Object.assign(console, saved);
  }
}
