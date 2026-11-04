import { quietly } from './helpers/setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, Team, User } from 'discord.js';
import echo from '../src/commands/echo.js';
import dm from '../src/commands/dm.js';
import tell from '../src/commands/tell.js';
import remind from '../src/commands/remind.js';
import reminders from '../src/commands/reminders.js';
import { addReminder, getReminders } from '../src/store.js';

const client = new Client({ intents: [] });
const member = (id, role, membership_state) => ({
  role,
  membership_state,
  team_id: '9',
  permissions: ['*'],
  user: { id, username: `u${id}`, discriminator: '0', avatar: null },
});
// 100 owns it, 101 is an admin, 102 an admin still invited, 103 a developer, 104 read-only.
const team = new Team(client, {
  id: '9',
  name: 't',
  icon: null,
  owner_user_id: '100',
  members: [
    member('100', 'admin', 2),
    member('101', 'admin', 2),
    member('102', 'admin', 1),
    member('103', 'developer', 2),
    member('104', 'read_only', 2),
  ],
});
const solo = new User(client, { id: '200', username: 'solo', discriminator: '0', avatar: null });

function fakeApp(owner, { lookupFails = false } = {}) {
  return {
    fetch: async () => {
      if (lookupFails) throw new Error('down');
      return { owner };
    },
  };
}

async function useEcho(
  owner,
  userId,
  { text = 'hello', channelFails = false, sendFails = false, lookupFails = false } = {}
) {
  const sent = [];
  const replies = [];
  let deferred = null;
  const interaction = {
    client: {
      application: fakeApp(owner, { lookupFails }),
      channels: {
        fetch: async (id) => {
          if (channelFails) throw new Error('Missing Access');
          return {
            id,
            send: async (m) => {
              if (sendFails) throw new Error('Missing Permissions');
              sent.push(m);
            },
          };
        },
      },
    },
    user: { id: userId, username: `u${userId}` },
    channelId: '555',
    deferReply: async (o) => {
      deferred = o;
    },
    editReply: async (r) => replies.push(r),
    options: { getString: () => text },
  };
  let threw = false;
  const { lines } = await quietly(() =>
    echo.execute(interaction).catch(() => {
      threw = true;
    })
  );
  return { sent, replies, deferred, lines, threw };
}

async function useDm(owner, userId) {
  let sent = false;
  await quietly(() =>
    dm.execute({
      client: { application: fakeApp(owner) },
      user: { id: userId, username: 'x' },
      deferReply: async () => {},
      editReply: async () => {},
      options: {
        getUser: () => ({
          username: 't',
          send: async () => {
            sent = true;
          },
        }),
        getString: () => 'hi',
      },
    })
  );
  return sent;
}

test('/echo: the owner and accepted admins can use it, nobody else', async () => {
  assert.equal((await useEcho(team, '100')).sent.length, 1);
  assert.equal((await useEcho(team, '101')).sent.length, 1);
  for (const id of ['102', '103', '104', '105']) {
    const r = await useEcho(team, id);
    assert.equal(r.sent.length, 0, id);
    assert.match(r.replies[0], /Nice try/);
    assert.ok(
      r.lines.some((l) => l.includes('tried')),
      'the attempt shows in the console'
    );
  }
  assert.equal((await useEcho(solo, '200')).sent.length, 1);
  assert.equal((await useEcho(solo, '201')).sent.length, 0);
});

test('/echo: says it privately, pings nobody, and records who did it', async () => {
  const r = await useEcho(team, '100', { text: '@everyone <@&1> <@2> hi' });
  assert.equal(r.deferred.flags, 64);
  assert.equal(r.sent[0].content, '@everyone <@&1> <@2> hi');
  assert.deepEqual(r.sent[0].allowedMentions, { parse: [] });
  assert.match(r.replies[0], /^✅/);
  assert.ok(r.lines.some((l) => l.includes('u100') && l.includes('555')));
});

test('/echo: where she cannot post, she says so; if the lookup fails, nothing goes out', async () => {
  for (const problem of [{ channelFails: true }, { sendFails: true }]) {
    const r = await useEcho(team, '100', problem);
    assert.match(r.replies[0], /^❌/);
    assert.ok(!r.threw);
  }
  const r = await useEcho(team, '100', { lookupFails: true });
  assert.equal(r.sent.length, 0);
  assert.ok(r.threw);
});

test('/dm uses the same rule', async () => {
  assert.ok(await useDm(team, '101'));
  assert.ok(!(await useDm(team, '103')));
});

test('/dm and /echo are hidden from non-admins in servers', () => {
  assert.equal(dm.data.toJSON().default_member_permissions, '0');
  assert.equal(echo.data.toJSON().default_member_permissions, '0');
  assert.equal(echo.data.toJSON().options[0].max_length, 2000);
});

const person = (id, username) => ({ id, username, toString: () => `<@${id}>` });
const ana = person('10', 'ana');
const ben = person('20', 'ben');
const bot = person('1', 'Ghost');

async function useTell(message, target = null) {
  const replies = [];
  const { lines } = await quietly(() =>
    tell.execute({
      user: ana,
      client: { user: bot },
      options: { getUser: () => target, getString: () => message },
      reply: async (r) => replies.push(r),
    })
  );
  return { reply: replies[0], count: replies.length, lines };
}

test('/tell: passes it on publicly, naming both, pinging only them', async () => {
  const r = await useTell('dinner at 8', ben);
  assert.equal(r.count, 1);
  assert.equal(r.reply.flags, undefined);
  assert.ok(r.reply.content.includes('<@20>') && r.reply.content.includes('<@10>'));
  assert.ok(r.reply.content.includes('\n> dinner at 8'));
  assert.deepEqual(r.reply.allowedMentions, { users: ['20'] });
  assert.ok(r.lines.some((l) => l.includes('ana') && l.includes('for ben')));
});

test('/tell: to everyone, to themselves, and to her', async () => {
  const everyone = await useTell('pizza is here');
  assert.deepEqual(everyone.reply.allowedMentions, { users: [] });
  assert.ok(!everyone.reply.content.includes('{'));
  const self = await useTell('note to self', ana);
  assert.match(self.reply.content, /^You want me to tell you/);
  assert.deepEqual(self.reply.allowedMentions, { users: [] });
  const her = await useTell('hi ghost', bot);
  assert.equal(her.reply.flags, 64);
  assert.ok(!her.reply.content.includes('hi ghost'));
});

test('/tell: refuses to pass on self-harm, privately, and logs nothing', async () => {
  const r = await useTell('go kill yourself', ben);
  assert.equal(r.reply.flags, 64);
  assert.ok(!r.reply.content.includes('kill'));
  assert.equal(r.lines.length, 0);
});

test('/tell: their text stays as typed, pings nobody else, and always fits', async () => {
  assert.deepEqual((await useTell('@everyone <@&5> <@30> look', ben)).reply.allowedMentions, {
    users: ['20'],
  });
  assert.ok(
    (await useTell('costs $& and $1 and {sender}', ben)).reply.content.includes(
      '> costs $& and $1 and {sender}'
    )
  );
  assert.ok((await useTell('x'.repeat(1500), ben)).reply.content.length <= 2000);
  const data = tell.data.toJSON();
  assert.deepEqual(data.contexts, [0, 1, 2]);
  assert.deepEqual(data.integration_types, [0, 1]);
  assert.equal(data.options[0].max_length, 1500);
});

// /reminders, with reminders put straight into the test database: no timers running.
function remindersInteraction(userId, subcommand, { id = null, focused = '' } = {}) {
  const replies = [];
  return {
    replies,
    user: { id: userId },
    options: { getSubcommand: () => subcommand, getInteger: () => id, getFocused: () => focused },
    reply: async (r) => replies.push(r),
    respond: async (choices) => replies.push(choices),
  };
}

test('/reminders list: only theirs, soonest first, privately, pinging nobody', async () => {
  const now = Date.now();
  const later = addReminder({
    userId: 'r1',
    channelId: 'c',
    reason: 'later one',
    minutes: 120,
    dueAt: now + 7200000,
  });
  const sooner = addReminder({
    userId: 'r1',
    channelId: 'c',
    reason: 'sooner @everyone',
    minutes: 5,
    dueAt: now + 300000,
  });
  addReminder({
    userId: 'r2',
    channelId: 'c',
    reason: 'not yours',
    minutes: 5,
    dueAt: now + 300000,
  });

  const i = remindersInteraction('r1', 'list');
  await reminders.execute(i);
  const { content, flags, allowedMentions } = i.replies[0];
  assert.equal(flags, 64);
  assert.deepEqual(allowedMentions, { parse: [] });
  assert.ok(content.indexOf(`#${sooner.id}`) < content.indexOf(`#${later.id}`));
  assert.ok(!content.includes('not yours'));
  assert.match(content, /<t:\d+:R>/);

  const none = remindersInteraction('nobody', 'list');
  await reminders.execute(none);
  assert.match(none.replies[0].content, /Nothing waiting/);
});

test('/reminders cancel: only their own, and it is gone', async () => {
  const mine = addReminder({
    userId: 'c1',
    channelId: 'c',
    reason: 'cancel me',
    minutes: 5,
    dueAt: Date.now() + 300000,
  });
  const theirs = addReminder({
    userId: 'c2',
    channelId: 'c',
    reason: 'keep me',
    minutes: 5,
    dueAt: Date.now() + 300000,
  });

  const wrong = remindersInteraction('c1', 'cancel', { id: theirs.id });
  await reminders.execute(wrong);
  assert.match(wrong.replies[0].content, /don't have a reminder/);
  assert.ok(getReminders().some((r) => r.id === theirs.id));

  const right = remindersInteraction('c1', 'cancel', { id: mine.id });
  await reminders.execute(right);
  assert.match(right.replies[0].content, /Forgot about/);
  assert.ok(!getReminders().some((r) => r.id === mine.id));
});

test('/reminders cancel suggests only their own, filtered by what they type', async () => {
  addReminder({
    userId: 'a1',
    channelId: 'c',
    reason: 'buy milk',
    minutes: 60,
    dueAt: Date.now() + 3600000,
  });
  addReminder({
    userId: 'a1',
    channelId: 'c',
    reason: 'call mom',
    minutes: 1440,
    dueAt: Date.now() + 86400000,
  });
  addReminder({
    userId: 'a2',
    channelId: 'c',
    reason: 'buy eggs',
    minutes: 60,
    dueAt: Date.now() + 3600000,
  });

  const all = remindersInteraction('a1', 'cancel');
  await reminders.autocomplete(all);
  assert.equal(all.replies[0].length, 2);
  assert.ok(all.replies[0].some((c) => c.name.includes('call mom (1 day)')));

  const typed = remindersInteraction('a1', 'cancel', { focused: 'milk' });
  await reminders.autocomplete(typed);
  assert.deepEqual(
    typed.replies[0].map((c) => c.name.replace(/^#\d+: /, '')),
    ['buy milk (1 hour)']
  );
});

test('/remind: a month at most, and nothing is stored past that', async () => {
  const edits = [];
  const before = getReminders().length;
  await remind.execute({
    client: {},
    user: { id: 'm1' },
    channelId: 'c',
    deferReply: async () => {},
    editReply: async (t) => edits.push(t),
    options: { getInteger: () => 31, getString: (name) => (name === 'unit' ? 'days' : 'too long') },
  });
  assert.match(edits[0], /A month, tops/);
  assert.equal(getReminders().length, before);
  const options = remind.data.toJSON().options;
  assert.deepEqual(
    options.map((o) => o.name),
    ['duration', 'reason', 'unit']
  );
  assert.deepEqual(
    options[2].choices.map((c) => c.value),
    ['minutes', 'hours', 'days']
  );
});
