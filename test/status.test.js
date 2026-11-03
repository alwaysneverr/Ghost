import { quietly } from './helpers/setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, Team } from 'discord.js';
import status, { formatStatus } from '../src/commands/status.js';
import { gatherStatus } from '../src/status.js';

const client = { guilds: { cache: { size: 3 } }, ws: { ping: 42.4 }, uptime: 2 * 3600000 + 15 * 60000 };

// Ollama's three status endpoints, answering as told.
function fakeOllama({ down = false, installed = ['qwen3:8b', 'bge-m3:latest'], loaded = ['qwen3:8b', 'bge-m3:latest'] } = {}) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), body: options.body });
    if (down) throw new TypeError('fetch failed');
    const path = new URL(url).pathname;
    if (path === '/api/version') return Response.json({ version: '0.40.13' });
    if (path === '/api/tags') return Response.json({ models: installed.map((name) => ({ name })) });
    if (path === '/api/ps') {
      return Response.json({
        models: loaded.map((name) => ({ name, size_vram: 7.5e9, context_length: 16384, expires_at: new Date(Date.now() + 52 * 60000).toISOString() })),
      });
    }
    if (path === '/api/chat') return Response.json({ message: { content: '' }, done_reason: 'load' });
    if (path === '/api/embed') return Response.json({ embeddings: [[0.1, 0.2]] });
    return new Response('not found', { status: 404 });
  };
  return calls;
}

test('everything working: both models loaded, with when they unload', async () => {
  fakeOllama();
  const text = formatStatus(await gatherStatus(client));
  assert.match(text, /🟢 Ollama 0\.40\.13/);
  assert.match(text, /🟢 qwen3:8b loaded \(7\.5 GB on the GPU, 16384 context, unloads in 5\d min\)/);
  assert.match(text, /🟢 bge-m3 loaded/);
  assert.match(text, /3 server\(s\), 42 ms ping, up 2h 15m/);
  assert.match(text, /ghost\.db: \d+ conversation/);
});

test('a model not loaded says the next reply will wait', async () => {
  fakeOllama({ loaded: ['bge-m3:latest'] });
  assert.match(formatStatus(await gatherStatus(client)), /⚪ qwen3:8b isn't loaded, so the next reply waits/);
});

test('a model not installed says how to get it', async () => {
  fakeOllama({ installed: ['qwen3:8b'], loaded: ['qwen3:8b'] });
  assert.match(formatStatus(await gatherStatus(client)), /🔴 bge-m3 isn't installed\. Run `ollama pull bge-m3`/);
});

test('Ollama down: says she cannot reply, and still shows the rest', async () => {
  fakeOllama({ down: true });
  const text = formatStatus(await gatherStatus(client));
  assert.match(text, /🔴 Can't reach Ollama at http:\/\/localhost:11434 \(fetch failed\)\. She can't reply/);
  assert.match(text, /Discord: 3 server/);
  assert.match(text, /💾 ghost\.db/);
});

test('no scene index: says how to build one', async () => {
  fakeOllama();
  assert.match(formatStatus(await gatherStatus(client)), /⚪ Scenes: none.*npm run index/);
});

const discord = new Client({ intents: [] });
const team = new Team(discord, {
  id: '9',
  name: 't',
  icon: null,
  owner_user_id: '100',
  members: [{ role: 'admin', membership_state: 2, team_id: '9', permissions: ['*'], user: { id: '100', username: 'owner', discriminator: '0', avatar: null } }],
});

async function useStatus(userId, { load = false } = {}) {
  const replies = [];
  let deferred = null;
  await quietly(() =>
    status.execute({
      client: { ...client, application: { fetch: async () => ({ owner: team }) } },
      user: { id: userId, username: `u${userId}` },
      options: { getBoolean: () => load },
      deferReply: async (o) => { deferred = o; },
      editReply: async (r) => replies.push(r),
    })
  );
  return { replies, deferred };
}

test('/status: private, and only for the owner and team admins', async () => {
  fakeOllama();
  const owner = await useStatus('100');
  assert.equal(owner.deferred.flags, 64);
  assert.match(owner.replies[0], /🟢 Ollama/);
  const stranger = await useStatus('555');
  assert.match(stranger.replies[0], /Nice try/);
  assert.ok(!stranger.replies[0].includes('Ollama'));
  assert.equal(status.data.toJSON().default_member_permissions, '0');
});

test('/status load_models: loads both, at the chat context size', async () => {
  const calls = fakeOllama();
  const { replies } = await useStatus('100', { load: true });
  assert.match(replies[0], /^Loaded the models in/);
  const load = calls.find((c) => c.url.endsWith('/api/chat'));
  assert.deepEqual(JSON.parse(load.body).messages, []);
  assert.ok(calls.some((c) => c.url.endsWith('/api/embed')));
});
