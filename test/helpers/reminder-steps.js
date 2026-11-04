// The real reminders code, store and commands, with Discord faked and time running
// 1000 times faster. reminders.test.js runs each step as its own process, one after
// another on the same database, so a "restart" is a real restart.
// node test/helpers/reminder-steps.js <step>, with GHOST_DB_PATH set to a temp file.
import { DatabaseSync } from 'node:sqlite';

const DB = process.env.GHOST_DB_PATH;
if (!DB) throw new Error('needs a temp GHOST_DB_PATH');
const step = process.argv[2];

const realSetTimeout = globalThis.setTimeout;
// "long" checks the real timer limit, so its time runs normally.
if (step !== 'long')
  globalThis.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, ms / 1000, ...rest);
const wait = (ms) => new Promise((resolve) => realSetTimeout(resolve, ms));

const store = await import('../../src/store.js');
const { restoreReminders, createReminder, cancelReminder } = await import('../../src/reminders.js');
const { default: remind } = await import('../../src/commands/remind.js');
const { default: ready } = await import('../../src/events/ready.js');

let failures = 0;
const ok = (name, good) => {
  if (!good) failures++;
  console.log(`${good ? 'PASS' : 'FAIL'}  ${name}`);
};
const sql = () => new DatabaseSync(DB);

function fakeClient({ channelFails = false, sendFails = false, dmFails = false } = {}) {
  const sent = [];
  return {
    sent,
    channels: {
      fetch: async (id) => {
        if (channelFails) throw new Error('Missing Access');
        return {
          send: async (m) => {
            if (sendFails) throw new Error('Missing Permissions');
            sent.push({ to: `channel:${id}`, ...m });
          },
        };
      },
    },
    users: {
      fetch: async (id) => ({
        send: async (m) => {
          if (dmFails) throw new Error('Cannot send messages to this user');
          sent.push({ to: `dm:${id}`, ...m });
        },
      }),
    },
    user: { username: 'Ghost', setActivity: () => {} },
    guilds: { cache: { size: 1 } },
  };
}

function fakeInteraction(
  client,
  { user = 'u1', channel = 'c1', duration = 1, unit = null, reason = 'stretch' } = {}
) {
  const log = { edits: [], followUps: 0 };
  return {
    log,
    client,
    user: { id: user, toString: () => `<@${user}>` },
    channelId: channel,
    deferReply: async () => {},
    editReply: async (t) => {
      log.edits.push(t);
    },
    followUp: async () => {
      log.followUps++;
    },
    options: { getInteger: () => duration, getString: (name) => (name === 'unit' ? unit : reason) },
  };
}

// Swallows warnings and the ready event's own messages, so only results get printed.
async function quiet(fn) {
  const saved = { warn: console.warn, log: console.log };
  const lines = [];
  console.warn = () => {};
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await fn();
  } finally {
    Object.assign(console, saved);
  }
  return lines;
}

// Ollama isn't running in tests, and the ready event warms the models up.
globalThis.fetch = async () => {
  throw new Error('No network in tests');
};

if (step === 'old-schema') {
  const db = sql();
  db.exec(`CREATE TABLE channel_state (channel_id TEXT PRIMARY KEY, history TEXT NOT NULL, past_replies TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE user_facts (user_id TEXT NOT NULL, scope TEXT NOT NULL, fact TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, scope, fact));
    INSERT INTO user_facts VALUES ('u9', 'dm', 'has a cat', 1);`);
  db.close();
  ok(
    'an older database gets the new table and keeps its facts',
    store.getReminders().length === 0 && store.getFacts('u9', 'dm').includes('has a cat')
  );
}

if (step === 'deliver') {
  const client = fakeClient();
  let i = fakeInteraction(client);
  await remind.execute(i);
  ok('/remind confirms', i.log.edits.length === 1 && !i.log.edits[0].includes('pile'));
  ok(
    'it is stored at once',
    store.getReminders().length === 1 && store.getReminders()[0].reason === 'stretch'
  );
  await wait(120);
  ok(
    'it arrives in the same channel',
    client.sent.length === 1 &&
      client.sent[0].to === 'channel:c1' &&
      client.sent[0].content.includes('stretch')
  );
  ok('and it pings them', client.sent[0].content.includes('<@u1>'));
  ok('and is gone from disk', store.getReminders().length === 0);
  ok('no interaction follow-up used', i.log.followUps === 0);

  i = fakeInteraction(client, { duration: 45, reason: 'past the 15 minute token limit' });
  await remind.execute(i);
  await wait(2800);
  ok(
    'a 45-minute one arrives, with no interaction token',
    client.sent.some((s) => s.content.includes('past the 15 minute')) && i.log.followUps === 0
  );

  i = fakeInteraction(client, { reason: '@everyone <@&123> <@999> free nitro' });
  await remind.execute(i);
  await wait(120);
  const pinged = client.sent.at(-1);
  ok(
    'its text can be seen, but only they can be pinged',
    pinged.content.includes('@everyone') &&
      JSON.stringify(pinged.allowedMentions) === '{"users":["u1"]}'
  );

  await remind.execute(fakeInteraction(client, { reason: 'x'.repeat(5000) }));
  await wait(120);
  ok('never over 2000 characters', client.sent.at(-1).content.length <= 2000);

  for (let n = 0; n < 20; n++)
    createReminder(client, { userId: 'full', channelId: 'c', reason: `r${n}`, minutes: 60 });
  ok('20 can be waiting', store.countReminders('full') === 20);
  i = fakeInteraction(client, { user: 'full', reason: 'one too many' });
  await remind.execute(i);
  ok(
    'the 21st is refused, and not stored',
    i.log.edits[0].includes('pile') && store.countReminders('full') === 20
  );
  await remind.execute(
    fakeInteraction(client, { user: 'other', duration: 60, reason: 'someone else' })
  );
  ok('that limit is per person', store.countReminders('other') === 1);
  sql().exec("DELETE FROM reminders WHERE user_id IN ('full', 'other')");
}

if (step === 'units') {
  const client = fakeClient();
  const before = Date.now();
  let i = fakeInteraction(client, { duration: 2, unit: 'hours', reason: 'two hours' });
  await remind.execute(i);
  let stored = store.getReminders().find((r) => r.reason === 'two hours');
  ok(
    'hours: stored as minutes, due in 2 hours',
    stored?.minutes === 120 && Math.abs(stored.dueAt - before - 2 * 3600000) < 5000
  );
  ok('hours: the confirmation says so', i.log.edits[0].includes('2 hours'));

  i = fakeInteraction(client, { duration: 3, unit: 'days', reason: 'three days' });
  await remind.execute(i);
  stored = store.getReminders().find((r) => r.reason === 'three days');
  ok('days: stored as minutes', stored?.minutes === 3 * 1440);
  ok('days: the confirmation says so', i.log.edits[0].includes('3 days'));

  i = fakeInteraction(client, { duration: 90, reason: 'ninety minutes' });
  await remind.execute(i);
  ok('no unit means minutes', i.log.edits[0].includes('90 minutes'));
  ok(
    'one says "1 day", not "1 days"',
    (await import('../../src/reminders.js')).describeMinutes(1440) === '1 day'
  );

  await wait(9000);
  const arrived = client.sent.find((s) => s.content.includes('two hours'));
  // Only one of her lines says how long she waited, so it's either "2 hours" or nothing.
  ok(
    'the 2-hour one arrives, never saying "120 minutes"',
    arrived && !arrived.content.includes('120 minutes')
  );
  sql().exec('DELETE FROM reminders');

  createReminder(client, { userId: 'u5', channelId: 'c5', reason: 'cancel me', minutes: 1 });
  const [mine] = store.getRemindersFor('u5');
  ok(
    'someone else cannot cancel it',
    !cancelReminder('u6', mine.id) && store.getRemindersFor('u5').length === 1
  );
  ok('they can', cancelReminder('u5', mine.id) && store.getRemindersFor('u5').length === 0);
  await wait(150);
  ok('a cancelled one never goes off', !client.sent.some((s) => s.content.includes('cancel me')));
}

if (step === 'long') {
  // Node fires a timer longer than about 24.8 days straight away, so a 30-day reminder
  // would go off at once without waiting in steps.
  const client = fakeClient();
  await quiet(() =>
    createReminder(client, {
      userId: 'u7',
      channelId: 'c7',
      reason: 'a month off',
      minutes: 30 * 1440,
    })
  );
  await wait(300);
  ok('a 30-day reminder does not go off straight away', client.sent.length === 0);
  ok('and it is still waiting', store.getRemindersFor('u7').length === 1);
  sql().exec('DELETE FROM reminders');
}

if (step === 'before-restart') {
  // One due while the bot's off, one due later, one due long ago.
  const now = Date.now();
  store.addReminder({
    userId: 'u1',
    channelId: 'c1',
    reason: 'came due while off',
    minutes: 5,
    dueAt: now - 10 * 60 * 1000,
  });
  store.addReminder({
    userId: 'u1',
    channelId: 'c1',
    reason: 'still in the future',
    minutes: 30,
    dueAt: now + 60 * 1000,
  });
  store.addReminder({
    userId: 'u2',
    channelId: 'c2',
    reason: 'days overdue',
    minutes: 5,
    dueAt: now - 3 * 24 * 60 * 60 * 1000,
  });
  ok('three are waiting when the process ends', store.getReminders().length === 3);
}

if (step === 'after-restart') {
  const client = fakeClient();
  const before = store.getReminders().map((r) => r.reason);
  ok(
    'all three survive the restart',
    ['came due while off', 'still in the future', 'days overdue'].every((r) => before.includes(r))
  );
  const lines = await quiet(() => ready.execute(client));
  ok(
    'the ready event restores them',
    lines.some((l) => l.includes('Restored'))
  );
  await wait(30);
  const late = client.sent.find((s) => s.content.includes('came due while off'));
  ok(
    'one that came due while off goes out straight away, and says so',
    late && /10 minute\(s\) late/.test(late.content)
  );
  ok(
    'one days overdue still goes out',
    client.sent.some((s) => s.content.includes('days overdue'))
  );
  ok(
    'the future one has not gone off yet',
    !client.sent.some((s) => s.content.includes('still in the future'))
  );
  await wait(120);
  ok(
    'it goes off on time, without a late note',
    client.sent.some(
      (s) => s.content.includes('still in the future') && !s.content.includes('late.')
    )
  );
  ok(
    'nothing is sent twice',
    new Set(client.sent.map((s) => s.content)).size === client.sent.length
  );
  sql().exec('DELETE FROM reminders');
}

if (step === 'failures') {
  const warn = console.warn;
  console.warn = () => {};
  await (async () => {
    let client = fakeClient({ channelFails: true });
    createReminder(client, {
      userId: 'u1',
      channelId: 'gone',
      reason: 'unreachable channel',
      minutes: 1,
    });
    await wait(120);
    ok(
      'channel unreachable: DM instead',
      client.sent.length === 1 && client.sent[0].to === 'dm:u1'
    );
    ok('and it is gone from disk', store.getReminders().length === 0);

    client = fakeClient({ sendFails: true });
    createReminder(client, {
      userId: 'u1',
      channelId: 'readonly',
      reason: 'no send permission',
      minutes: 1,
    });
    await wait(120);
    ok(
      'no permission to post: DM instead',
      client.sent.length === 1 && client.sent[0].to === 'dm:u1'
    );

    const flaky = fakeClient({ channelFails: true, dmFails: true });
    createReminder(flaky, {
      userId: 'u1',
      channelId: 'x',
      reason: 'both fail at first',
      minutes: 1,
    });
    await wait(120);
    ok('both fail: nothing lost', store.getReminders().length === 1 && flaky.sent.length === 0);
    flaky.users.fetch = async (id) => ({
      send: async (m) => {
        flaky.sent.push({ to: `dm:${id}`, ...m });
      },
    });
    await wait(400);
    ok(
      'it is tried again and delivered',
      flaky.sent.length === 1 && store.getReminders().length === 0
    );

    const dead = fakeClient({ channelFails: true, dmFails: true });
    store.addReminder({
      userId: 'u3',
      channelId: 'x',
      reason: 'hopeless',
      minutes: 1,
      dueAt: Date.now() - 25 * 60 * 60 * 1000,
    });
    restoreReminders(dead);
    await wait(60);
    ok('a day overdue and undeliverable: dropped', store.getReminders().length === 0);
  })();
  console.warn = warn;
}

await wait(10);
process.exit(failures ? 1 : 0);
