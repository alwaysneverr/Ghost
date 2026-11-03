import { quietly, stubOllama } from './helpers/setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import event from '../src/events/messageCreate.js';
import { character } from '../src/character.js';

const ollama = stubOllama();
const sent = [];

// One message through the real handler, with Discord faked. Returns her reply, and
// whether it came with rating buttons.
async function say(channel, content, { id = '2', name = 'Ana', dm = true } = {}) {
  let replied = null;
  let buttons = false;
  await quietly(() =>
    event.execute({
      client: { user: { id: '1' } },
      author: { bot: false, id, displayName: name, username: name, toString: () => `<@${id}>` },
      member: { displayName: name },
      webhookId: null,
      guildId: dm ? null : 'g',
      guild: dm ? null : { name: 'G' },
      id: `m${Math.random()}`,
      attachments: new Map(),
      mentions: { has: () => !dm, everyone: false },
      channel: { id: channel, isDMBased: () => dm, sendTyping: async () => {} },
      content,
      reply: async (r) => {
        replied = typeof r === 'string' ? r : r.content;
        buttons = (r.components?.length ?? 0) > 0;
        sent.push(replied);
        return { id: `s${Math.random()}` };
      },
    })
  );
  return { reply: replied, buttons };
}

const last = () => ollama.calls.at(-1);
const lastPrompt = () => last().messages[0].content;
const lastTurns = () => last().messages.slice(1).map((m) => m.content);

test('a short conversation goes to the model whole', async () => {
  for (let i = 1; i <= 3; i++) await say('short', `message ${i}`);
  assert.equal(lastTurns().filter((c) => c.startsWith('message')).length, 3);
  assert.ok(!lastPrompt().includes('earlier in this conversation'));
});

test('a long one: her last 3 replies, their older messages moved into the prompt', async () => {
  const firstReply = sent.length;
  for (let i = 1; i <= 8; i++) await say('long', `saying thing ${i}`);
  assert.equal(last().messages.filter((m) => m.role === 'assistant').length, 3);
  assert.equal(last().messages[1].role, 'user');
  assert.equal(lastTurns().at(-1), 'saying thing 8');
  assert.ok(['saying thing 1', 'saying thing 4'].every((m) => lastPrompt().includes(`- ${m}`)));
  assert.ok(!lastPrompt().includes('- saying thing 5'));
  assert.ok(!JSON.stringify(last().messages).includes(sent[firstReply]));
});

test('harmful every try: the person gets the fallback', async () => {
  await say('harm', 'hello there');
  ollama.queue("You're gonna kill yourself. Just do it.", 'Kill yourself.', 'kys');
  const { reply } = await say('harm', 'i always get nervous');
  // About 1 reply in 5 gets ", Nine" added to the end.
  assert.match(reply, /^Tch\. Forget it(?:, Nine)?\.$/);
});

test('grief: a gentle prompt that keeps the whole conversation, and no rating buttons', async () => {
  for (let i = 1; i <= 5; i++) await say('sad', `small talk number ${i}`);
  for (const m of ['my dog died this morning', 'he was 14', 'i miss him']) await say('sad', m);
  const { buttons } = await say('sad', 'it was so sudden');
  assert.equal(lastPrompt(), character.griefPrompt);
  assert.ok(last().messages.some((m) => m.content === 'my dog died this morning'));
  assert.equal(buttons, false);
});

test('crisis: fixed text, no model, no rating buttons, and it holds for the follow-ups', async () => {
  await say('crisis', 'hi');
  const calls = ollama.calls.length;
  const first = await say('crisis', 'i want to kill myself');
  assert.equal(first.reply, character.crisisReply);
  assert.equal(first.buttons, false);
  for (const m of ['whatever', 'you dont get it']) {
    assert.equal((await say('crisis', m)).reply, character.crisisFollowUp);
  }
  assert.equal(ollama.calls.length, calls);
});

test('ordinary chat gets the full persona and rating buttons', async () => {
  const { buttons } = await say('normal', 'yo');
  assert.notEqual(lastPrompt(), character.griefPrompt);
  assert.ok(lastPrompt().startsWith(character.systemPrompt));
  assert.equal(buttons, true);
});

test('group chats: names on the turns, who said what in the prompt', async () => {
  for (let i = 1; i <= 4; i++) {
    await say('group', `ana line ${i}`, { id: '2', name: 'Ana', dm: false });
    await say('group', `ben line ${i}`, { id: '3', name: 'Ben', dm: false });
  }
  assert.equal(last().messages.filter((m) => m.role === 'assistant').length, 3);
  assert.equal(lastTurns().at(-1), 'Ben: ben line 4');
  assert.ok(lastPrompt().includes('Ana said: ana line 4'));
  assert.ok(!lastPrompt().includes('earlier in this conversation'));
});
