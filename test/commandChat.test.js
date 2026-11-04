import { TEST_DIR, quietly, stubOllama } from './helpers/setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { InteractionContextType } from 'discord.js';
import ask from '../src/commands/ask.js';
import replyAs from '../src/commands/replyAs.js';
import interactionCreate from '../src/events/interactionCreate.js';
import { memoryScope } from '../src/commandChat.js';
import { character } from '../src/character.js';
import { getFacts } from '../src/store.js';

const ollama = stubOllama();
const LOGS = join(TEST_DIR, 'logs');
const read = (file) =>
  existsSync(join(LOGS, file))
    ? readFileSync(join(LOGS, file), 'utf-8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

// Facts come back from Ollama for anything that names a cat, so memory can be checked.
const withFacts = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options.body);
  if (body.format?.properties?.facts && /cat/.test(JSON.stringify(body.messages))) {
    ollama.jsonCalls.push(body);
    return Response.json({
      message: { content: '{"facts":["has a cat named mochi"]}' },
      done_reason: 'stop',
    });
  }
  return withFacts(url, options);
};
const memoryCalls = () => ollama.jsonCalls.filter((call) => call.format.properties?.facts).length;
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const ana = { id: '10', username: 'ana', displayName: 'Ana', toString: () => '<@10>' };

function interaction({
  channelId = 'c1',
  guildId = null,
  context = InteractionContextType.BotDM,
  message = '',
  target = null,
  user = ana,
} = {}) {
  const calls = { deferred: null, edits: [], replies: [] };
  return {
    calls,
    id: `i${Math.random()}`,
    user,
    member: null,
    guildId,
    guild: guildId ? { name: 'G' } : null,
    channelId,
    context,
    client: { user: { id: '1' } },
    options: { getString: () => message },
    targetMessage: target,
    deferReply: async (options = {}) => {
      calls.deferred = options;
    },
    editReply: async (r) => {
      calls.edits.push(r);
      return { id: `reply${Math.random()}` };
    },
    reply: async (r) => calls.replies.push(r),
  };
}

const run = async (command, i) => {
  await quietly(() => command.execute(i));
  await settle();
  return i.calls;
};

test('/ask: a public reply that quotes the question, with rating buttons and no pings', async () => {
  const calls = await run(
    ask,
    interaction({ channelId: 'ask-1', message: 'what are you up to @everyone' })
  );
  assert.equal(calls.deferred.flags, undefined);
  const [edit] = calls.edits;
  assert.match(edit.content, /^> what are you up to @everyone\n./);
  assert.deepEqual(edit.allowedMentions, { parse: [] });
  assert.deepEqual(
    edit.components[0].toJSON().components.map((b) => b.custom_id),
    ['rate:up', 'rate:down']
  );
});

test('/ask: the exchange is logged, and what she was sent is logged as via /ask', async () => {
  await run(ask, interaction({ channelId: 'ask-2', message: 'hello from a group chat' }));
  assert.ok(
    read('conversations.jsonl').some(
      (r) =>
        r.type === 'exchange' && r.userMessage === 'hello from a group chat' && r.userId === '10'
    )
  );
  const received = read('messages.jsonl').find((r) => r.content === 'hello from a group chat');
  assert.equal(received.direction, 'received');
  assert.equal(received.via, '/ask');
});

test('/ask: she remembers the conversation across uses in the same channel', async () => {
  await run(ask, interaction({ channelId: 'ask-3', message: 'first thing i said' }));
  await run(ask, interaction({ channelId: 'ask-3', message: 'second thing' }));
  const turns = ollama.calls
    .filter((c) => !c.format)
    .at(-1)
    .messages.map((m) => m.content);
  assert.ok(turns.includes('first thing i said'));
  assert.equal(turns.at(-1), 'second thing');
});

test('/ask: crisis gets the fixed text privately, unquoted, with no buttons and no training log', async () => {
  const before = read('conversations.jsonl').length;
  const calls = await run(
    ask,
    interaction({ channelId: 'ask-crisis', message: 'i want to kill myself' })
  );
  assert.equal(calls.deferred.flags, 64);
  assert.equal(calls.edits[0].content, character.crisisReply);
  assert.deepEqual(calls.edits[0].components, []);
  assert.equal(read('conversations.jsonl').length, before);
  assert.equal(read('messages.jsonl').find((r) => r.channelId === 'ask-crisis').content, null);
});

test('/ask: grief is answered privately too', async () => {
  const calls = await run(
    ask,
    interaction({ channelId: 'ask-grief', message: 'my dog died this morning' })
  );
  assert.equal(calls.deferred.flags, 64);
  assert.ok(!calls.edits[0].content.startsWith('>'));
  assert.deepEqual(calls.edits[0].components, []);
});

test('/ask: if the model fails, she says so', async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('connection refused');
  };
  const calls = await run(ask, interaction({ channelId: 'ask-down', message: 'you there?' }));
  globalThis.fetch = saved;
  assert.match(calls.edits[0], /isn't responding/);
});

test('memory: a group DM keeps its own, apart from her DMs and servers', () => {
  assert.equal(
    memoryScope({ guildId: 'g1', context: InteractionContextType.Guild, channelId: 'x' }),
    'g1'
  );
  assert.equal(
    memoryScope({ guildId: null, context: InteractionContextType.BotDM, channelId: 'x' }),
    'dm'
  );
  assert.equal(
    memoryScope({ guildId: null, context: InteractionContextType.PrivateChannel, channelId: 'x' }),
    'group:x'
  );
});

test('/ask in a group DM: what they tell her is kept for that group DM only', async () => {
  await run(
    ask,
    interaction({
      channelId: 'gdm-1',
      context: InteractionContextType.PrivateChannel,
      message: 'i have a cat named mochi',
    })
  );
  await settle();
  assert.deepEqual(getFacts('10', 'group:gdm-1'), ['has a cat named mochi']);
  assert.deepEqual(getFacts('10', 'dm'), []);
});

const message = (author, content) => ({ author, content, member: null });
const ben = { id: '20', username: 'ben', displayName: 'Ben' };

test("Reply as: answers someone else's message, quoting it with their name", async () => {
  const calls = await run(
    replyAs,
    interaction({ channelId: 'menu-1', target: message(ben, 'anyone want pizza') })
  );
  const [edit] = calls.edits;
  assert.match(edit.content, /^> \*\*Ben:\*\* anyone want pizza\n./);
  assert.equal(edit.components.length, 1);
  assert.ok(
    read('conversations.jsonl').some(
      (r) => r.userMessage === 'anyone want pizza' && r.userId === '20'
    )
  );
  assert.equal(
    read('messages.jsonl').find((r) => r.content === 'anyone want pizza').via,
    replyAs.data.name
  );
});

test('Reply as: nothing is remembered from a message that was not said to her', async () => {
  const before = memoryCalls();
  await run(
    replyAs,
    interaction({ channelId: 'menu-2', target: message(ben, 'i have a cat named biscuit') })
  );
  await settle();
  assert.equal(memoryCalls(), before);
  assert.deepEqual(getFacts('20', 'dm'), []);
});

test('Reply as: refuses her own messages and messages with no text, privately', async () => {
  const own = await run(
    replyAs,
    interaction({ target: message({ id: '1', username: 'Ghost' }, 'hi') })
  );
  assert.equal(own.replies[0].flags, 64);
  assert.equal(own.deferred, null);
  const empty = await run(replyAs, interaction({ target: message(ben, '   ') }));
  assert.match(empty.replies[0].content, /nothin' there/);
});

test('Reply as is a message command named after her', () => {
  const data = replyAs.data.toJSON();
  assert.equal(data.type, 3);
  assert.equal(data.name, `Reply as ${character.name}`);
  assert.deepEqual(data.contexts, [0, 1, 2]);
});

function button(customId, messageId = 'reply-msg') {
  const replies = [];
  return {
    replies,
    customId,
    message: { id: messageId },
    user: { id: '30' },
    isButton: () => true,
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isMessageContextMenuCommand: () => false,
    reply: async (r) => replies.push(r),
  };
}

test('👍/👎 buttons: each press is logged as a rating, and only the presser sees a reply', async () => {
  const up = button('rate:up', 'rated-1');
  await quietly(() => interactionCreate.execute(up));
  const down = button('rate:down', 'rated-1');
  await quietly(() => interactionCreate.execute(down));
  const ratings = read('conversations.jsonl').filter(
    (r) => r.type === 'rating' && r.messageId === 'rated-1'
  );
  assert.deepEqual(
    ratings.map((r) => [r.rating, r.raterId]),
    [
      ['up', '30'],
      ['down', '30'],
    ]
  );
  assert.equal(up.replies[0].flags, 64);
  assert.equal(down.replies[0].flags, 64);
});

test('other buttons are left alone', async () => {
  const other = button('something:else', 'rated-2');
  await quietly(() => interactionCreate.execute(other));
  assert.ok(!read('conversations.jsonl').some((r) => r.messageId === 'rated-2'));
});

test('"Reply as" from the Apps menu reaches its command', async () => {
  let ran = false;
  const i = {
    commandName: replyAs.data.name,
    client: {
      commands: new Map([
        [
          replyAs.data.name,
          {
            execute: async () => {
              ran = true;
            },
          },
        ],
      ]),
    },
    isButton: () => false,
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isMessageContextMenuCommand: () => true,
  };
  await interactionCreate.execute(i);
  assert.ok(ran);
});
