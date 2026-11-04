import { TEST_DIR, quietly, stubOllama } from './helpers/setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ChannelType, Client, MessageFlagsBitField } from 'discord.js';
import event from '../src/events/messageCreate.js';
import updateEvent from '../src/events/messageUpdate.js';

stubOllama();
const LOG = join(TEST_DIR, 'logs', 'messages.jsonl');
const rows = () =>
  existsSync(LOG)
    ? readFileSync(LOG, 'utf-8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

// discord.js's real DM channels, so recipients work the way they do live.
const client = new Client({ intents: [] });
client.user = { id: '1' };
const ghost = client.users._add({
  id: '1',
  username: 'Ghost',
  discriminator: '0',
  avatar: null,
  bot: true,
});
const user = (id, username) => ({ id, username, discriminator: '0', avatar: null });
client.users._add(user('20', 'ben'));
const dmWith = (id, recipient) => {
  const channel = client.channels._add({ id, type: ChannelType.DM, recipients: [recipient] });
  channel.isDMBased = () => true;
  channel.sendTyping = async () => {};
  return channel;
};
const benDm = dmWith('dm-ben', user('20', 'ben'));

const message = (author, channel, content, extra = {}) => ({
  id: `m${Math.random()}`,
  client,
  author,
  channel,
  content,
  guildId: null,
  guild: null,
  webhookId: null,
  attachments: new Map(),
  mentions: { has: () => false, everyone: false },
  reply: async () => ({ id: `r${Math.random()}`, react: async () => {} }),
  ...extra,
});
const person = (id, username) => ({ id, username, bot: false, toString: () => `<@${id}>` });
const run = (fn) => quietly(fn).then(({ lines }) => lines);

test('a DM she sends is logged as sent, with who it went to', async () => {
  const lines = await run(() => event.execute(message(ghost, benDm, 'Oi ben, Nine sent me.')));
  const row = rows().at(-1);
  assert.equal(row.direction, 'sent');
  assert.equal(row.content, 'Oi ben, Nine sent me.');
  assert.equal(row.recipientId, '20');
  assert.equal(row.recipientName, 'ben');
  assert.ok(lines.some((l) => l.startsWith('📤 [DM] to ben (20): Oi ben')));
});

test('a message to her is logged as received', async () => {
  await run(() => event.execute(message(person('20', 'ben'), benDm, 'hello there')));
  assert.ok(rows().some((r) => r.direction === 'received' && r.content === 'hello there'));
});

test('in a server: sent, no recipient, on one console line', async () => {
  const channel = { id: 'chan-1', isDMBased: () => false };
  const lines = await run(() =>
    event.execute(
      message(ghost, channel, 'Nine Ana wants everyone to hear this:\n> pizza', {
        guildId: 'g',
        guild: { name: 'Hush' },
      })
    )
  );
  const row = rows().at(-1);
  assert.equal(row.direction, 'sent');
  assert.equal(row.recipientId, null);
  assert.equal(row.guildName, 'Hush');
  assert.ok(
    lines.at(-1).includes('[Hush] in chan-1: Nine Ana wants everyone to hear this: > pizza')
  );
});

test('someone grieving: their message and her reply are both withheld', async () => {
  const sad = dmWith('dm-sad', user('30', 'cal'));
  await run(() => event.execute(message(person('30', 'cal'), sad, 'my dog died this morning')));
  const lines = await run(() => event.execute(message(ghost, sad, "I'm sorry about your dog.")));
  const [theirs, hers] = rows()
    .filter((r) => r.channelId === 'dm-sad')
    .slice(-2);
  assert.equal(theirs.withheld, true);
  assert.equal(theirs.content, null);
  assert.equal(hers.withheld, true);
  assert.equal(hers.content, null);
  assert.ok(lines.at(-1).includes('(withheld: grief or crisis)') && !lines.at(-1).includes('dog'));
});

test('a "thinking…" placeholder is logged once its text arrives, as a reply to the command', async () => {
  // /dm used in a DM between the user and ben, which she can't see into.
  const theirDm = dmWith('dm-you-and-ben', user('20', 'ben'));
  const asReply = {
    interactionMetadata: { user: { id: '99', username: 'alwaysnever' } },
    interaction: { commandName: 'dm' },
  };
  const count = rows().length;
  const placeholder = message(ghost, theirDm, '', {
    id: 'ph1',
    flags: new MessageFlagsBitField(64 | 128),
    ...asReply,
  });

  await run(() => event.execute(placeholder));
  assert.equal(rows().length, count, 'the empty placeholder is not logged');

  await run(() => event.execute(message(ghost, benDm, 'At this point just confess.')));
  assert.equal(rows().length, count + 1);
  assert.equal(rows().at(-1).recipientId, '20');

  const filled = message(ghost, theirDm, '✅ DM sent to ben', {
    id: 'ph1',
    flags: new MessageFlagsBitField(64),
    partial: false,
    ...asReply,
  });
  const lines = await run(() => updateEvent.execute(placeholder, filled));
  const row = rows().at(-1);
  assert.equal(rows().length, count + 2);
  assert.equal(row.content, '✅ DM sent to ben');
  assert.equal(row.recipientId, null);
  assert.equal(row.commandUserId, '99');
  assert.equal(row.command, 'dm');
  assert.ok(lines.at(-1).includes("reply to alwaysnever's /dm: ✅ DM sent to ben"));

  await run(() => updateEvent.execute(placeholder, filled));
  await run(() =>
    updateEvent.execute(null, message(ghost, benDm, 'edited something else', { id: 'other' }))
  );
  assert.equal(rows().length, count + 2, 'no double, and other edits are ignored');
});

test('her own messages never go through the chat path', async () => {
  const received = rows().filter((r) => r.direction === 'received').length;
  await run(() => event.execute(message(ghost, benDm, 'talking to myself')));
  assert.equal(rows().filter((r) => r.direction === 'received').length, received);
});
