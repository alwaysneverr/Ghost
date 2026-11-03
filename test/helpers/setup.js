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

// Stands in for Ollama. Chat replies come from `replies` in order, then made-up ones
// that share no words, so none of them counts as a repeat. Every chat request is kept
// in `calls`.
export function stubOllama(replies = []) {
  const queue = [...replies];
  const calls = [];
  const word = () => Array.from({ length: 7 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (String(url).endsWith('/api/embed')) {
      const n = Array.isArray(body.input) ? body.input.length : 1;
      return Response.json({ embeddings: Array.from({ length: n }, () => Array(1024).fill(0.01)) });
    }
    calls.push(body);
    if (body.format) return Response.json({ message: { content: '{"facts":[]}' }, done_reason: 'stop' });
    const content = queue.length > 0 ? queue.shift() : `${word()} ${word()} ${word()} ${word()}.`;
    return Response.json({ message: { content }, done_reason: 'stop' });
  };
  return {
    calls,
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
