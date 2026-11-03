import { TEST_DIR } from './helpers/setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pruneMessageLog } from '../src/logger.js';

const LOG = join(TEST_DIR, 'logs', 'messages.jsonl');
const CONVERSATIONS = join(TEST_DIR, 'logs', 'conversations.jsonl');
const NOW = Date.parse('2026-11-03T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();
const row = (n, content) => JSON.stringify({ type: 'message', timestamp: daysAgo(n), content });

function writeLog(lines) {
  mkdirSync(join(TEST_DIR, 'logs'), { recursive: true });
  writeFileSync(LOG, lines.map((line) => `${line}\n`).join(''));
}
const contents = () => readFileSync(LOG, 'utf-8').split('\n').filter(Boolean);

test('entries older than the limit go, newer ones stay, in order', () => {
  writeLog([row(45, 'old'), row(31, 'just too old'), row(29, 'recent'), row(0, 'today')]);
  assert.equal(pruneMessageLog({ days: 30, now: NOW }), 2);
  assert.deepEqual(contents().map((line) => JSON.parse(line).content), ['recent', 'today']);
});

test('a line it cannot read or date is kept', () => {
  writeLog([row(60, 'old'), 'not json at all', JSON.stringify({ type: 'message', content: 'no timestamp' })]);
  assert.equal(pruneMessageLog({ days: 30, now: NOW }), 1);
  assert.deepEqual(contents(), ['not json at all', JSON.stringify({ type: 'message', content: 'no timestamp' })]);
});

test('with no limit set, nothing is touched', () => {
  writeLog([row(400, 'ancient')]);
  assert.equal(pruneMessageLog({ days: null, now: NOW }), 0);
  assert.equal(contents().length, 1);
});

test('nothing old: the file is left as it was, and no temp file is left behind', () => {
  writeLog([row(1, 'fresh')]);
  const before = readFileSync(LOG, 'utf-8');
  assert.equal(pruneMessageLog({ days: 30, now: NOW }), 0);
  assert.equal(readFileSync(LOG, 'utf-8'), before);
  assert.ok(!existsSync(`${LOG}.tmp`));
});

test('the training log is never pruned', () => {
  writeFileSync(CONVERSATIONS, `${JSON.stringify({ type: 'exchange', timestamp: daysAgo(400) })}\n`);
  writeLog([row(400, 'ancient')]);
  pruneMessageLog({ days: 30, now: NOW });
  assert.equal(readFileSync(CONVERSATIONS, 'utf-8').split('\n').filter(Boolean).length, 1);
});
