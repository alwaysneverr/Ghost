// Staying up unattended: Ollama outages, slow answers, crowded channels, failed replies.
import { quietly, stubOllama, TEST_DIR } from './helpers/setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { character } from '../src/character.js';
import { converse } from '../src/conversation.js';
import messageCreate from '../src/events/messageCreate.js';
import interactionCreate from '../src/events/interactionCreate.js';
import { ollamaAnswered, ollamaFailed } from '../src/health.js';
import { OllamaError, ollamaPost } from '../src/ollama.js';
import { listScriptFiles } from '../scripts/lib/script-parser.js';
import { Client, Team } from 'discord.js';

async function failure(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('expected it to throw');
}

test('ollamaPost: unreachable, slow and erroring all count as Ollama being down', async () => {
  const saved = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new TypeError('fetch failed', { cause: { code: 'EHOSTUNREACH' } });
    };
    const unreachable = await failure(ollamaPost('/api/chat', {}));
    assert.ok(unreachable instanceof OllamaError);
    assert.match(unreachable.message, /can't reach Ollama .*EHOSTUNREACH/);

    // Never answers; only the time limit ends it. AbortSignal.timeout doesn't keep Node
    // running on its own (the Discord connection does, in the bot), so a timer does here.
    globalThis.fetch = (_url, { signal }) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason))
      );
    const awake = setTimeout(() => {}, 1000);
    const slow = await failure(ollamaPost('/api/chat', {}, 50));
    clearTimeout(awake);
    assert.ok(slow instanceof OllamaError);
    assert.match(slow.message, /no answer in 0s/);

    globalThis.fetch = async () => new Response('boom', { status: 500 });
    const erroring = await failure(ollamaPost('/api/chat', {}));
    assert.ok(erroring instanceof OllamaError);
    assert.match(erroring.message, /HTTP 500/);
  } finally {
    globalThis.fetch = saved;
  }
});

test('health: the owner hears once when Ollama goes, and once when it is back', async () => {
  const dms = [];
  const client = {
    application: { fetch: async () => ({ owner: { id: 'owner' } }) },
    users: { fetch: async () => ({ send: async (text) => dms.push(text) }) },
  };
  process.env.OLLAMA_ALERTS = 'true';
  try {
    await quietly(async () => {
      await ollamaAnswered(client); // nothing was wrong: no news
      await ollamaFailed(client, new OllamaError('no answer in 60s'));
      await ollamaFailed(client, new OllamaError('no answer in 60s'));
      await ollamaAnswered(client);
      await ollamaAnswered(client);
    });
  } finally {
    process.env.OLLAMA_ALERTS = 'false';
  }
  assert.equal(dms.length, 2);
  assert.match(dms[0], /stopped answering \(no answer in 60s\)/);
  assert.match(dms[1], /answering again/);
});

test("health: a team's owner and accepted admins all hear, and nobody else", async () => {
  const discord = new Client({ intents: [] });
  const member = (id, role, membership_state) => ({
    role,
    membership_state,
    team_id: '9',
    permissions: ['*'],
    user: { id, username: `u${id}`, discriminator: '0', avatar: null },
  });
  // 100 owns it, 101 is an admin, 102 an admin still invited, 103 a developer.
  const team = new Team(discord, {
    id: '9',
    name: 't',
    icon: null,
    owner_user_id: '100',
    members: [
      member('100', 'admin', 2),
      member('101', 'admin', 2),
      member('102', 'admin', 1),
      member('103', 'developer', 2),
    ],
  });
  const dmed = [];
  const client = {
    application: { fetch: async () => ({ owner: team }) },
    users: {
      fetch: async (id) => ({
        send: async () => {
          if (id === '101') throw new Error('Cannot send messages to this user');
          dmed.push(id);
        },
      }),
    },
  };
  process.env.OLLAMA_ALERTS = 'true';
  let lines, outageTo;
  try {
    ({ lines } = await quietly(() => ollamaFailed(client, new OllamaError('no answer in 60s'))));
    outageTo = [...dmed]; // the "back" DM below goes to the same people
    await quietly(() => ollamaAnswered(client));
  } finally {
    process.env.OLLAMA_ALERTS = 'false';
  }
  // 101 has DMs closed: the owner still hears, and the failure is only logged.
  assert.deepEqual(outageTo, ['100']);
  assert.ok(lines.some((line) => line.includes('Could not DM 101')));
  discord.destroy();
});

test('converse: two messages at once in a channel are answered in order', async () => {
  // Both already say Nine, so neither gets ", Nine" tacked on at random (maybeAddName).
  const ollama = stubOllama(['First answer, Nine.', 'Second answer, Nine.']);
  const say = (content) =>
    converse({ channelId: 'queued', speakerId: '2', speakerName: 'Ana', content, scope: 'dm' });
  const [first, second] = await quietly(() =>
    Promise.all([say('the first message'), say('the second message')])
  ).then(({ result }) => result);

  assert.equal(first.reply, 'First answer, Nine.');
  assert.equal(second.reply, 'Second answer, Nine.');
  // Her first reply was already in the history the second one was written from.
  const secondCall = ollama.calls.find((c) => c.messages.at(-1).content === 'the second message');
  const roles = secondCall.messages.slice(1).map((m) => `${m.role}: ${m.content}`);
  assert.deepEqual(roles.slice(-3), [
    'user: the first message',
    'assistant: First answer, Nine.',
    'user: the second message',
  ]);
});

test('messageCreate: with Ollama down she says her offline line, not a stack of details', async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
  };
  let replied = null;
  try {
    await quietly(() =>
      messageCreate.execute({
        client: { user: { id: '1' } },
        author: { bot: false, id: '2', displayName: 'Ana', username: 'Ana' },
        member: null,
        webhookId: null,
        guildId: null,
        id: 'm-down',
        attachments: new Map(),
        mentions: { has: () => false, everyone: false },
        channel: { id: 'down', isDMBased: () => true, sendTyping: async () => {} },
        content: 'you there?',
        reply: async (r) => {
          replied = typeof r === 'string' ? r : r.content;
          return { id: 's-down' };
        },
      })
    );
  } finally {
    globalThis.fetch = saved;
  }
  assert.equal(replied, character.offlineReply);
});

test("interactionCreate: a command failing after Discord's deadline doesn't escape", async () => {
  const interaction = {
    isButton: () => false,
    isAutocomplete: () => false,
    isChatInputCommand: () => true,
    isMessageContextMenuCommand: () => false,
    commandName: 'slow',
    replied: false,
    deferred: false,
    client: {
      commands: new Map([
        ['slow', { execute: async () => Promise.reject(new Error('took too long')) }],
      ]),
    },
    reply: async () => Promise.reject(new Error('Unknown interaction')),
  };
  const { lines } = await quietly(() => interactionCreate.execute(interaction));
  assert.ok(lines.some((line) => line.includes("Couldn't tell them /slow failed")));
});

test('listScriptFiles: folders in the scripts folder are skipped, not read as scripts', () => {
  const dir = join(TEST_DIR, 'scripts-with-folder');
  mkdirSync(join(dir, 'scn'), { recursive: true });
  writeFileSync(join(dir, 'a01.txt.md'), '');
  writeFileSync(join(dir, '.hidden'), '');
  assert.deepEqual(listScriptFiles(dir), ['a01.txt.md']);
});
