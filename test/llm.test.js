import { stubOllama } from './helpers/setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatFresh, recentStart, warmUp } from '../src/llm.js';
import { character } from '../src/character.js';

// One chatFresh call against canned replies. Returns what she sent and every request.
async function run(replies, options = {}, history = [{ role: 'user', content: 'hi' }]) {
  const ollama = stubOllama(replies);
  const reply = await chatFresh([{ role: 'system', content: 'prompt' }, ...history], options);
  return { reply, calls: ollama.calls };
}

test('a harmful reply is replaced by the next try', async () => {
  const { reply, calls } = await run(["You're gonna kill yourself. Just do it.", 'Tch. Whatever you say.']);
  assert.equal(reply, 'Tch. Whatever you say.');
  assert.equal(calls.length, 2);
});

test('harmful every time: the fallback goes out instead', async () => {
  const { reply, calls } = await run(['Kill yourself.', 'Kill yourself.', 'kys']);
  assert.equal(reply, character.fallbackReply);
  assert.equal(calls.length, 3);
});

test('harmful replies are blocked for someone grieving too', async () => {
  const { reply } = await run(['Kill yourself.', 'Go on then.'], { gentle: true });
  assert.equal(reply, 'Go on then.');
});

test('a harmful reply is never trimmed down and sent', async () => {
  const { reply } = await run(['Nah, go on. You wanna kill yourself? Go ahead.', 'Tch. Whatever.']);
  assert.equal(reply, 'Tch. Whatever.');
});

const habit = ["Ain't worth it. Otherwise, shut up."];

test('a sentence reusing a recent phrase is cut', async () => {
  const { reply } = await run(['Sick of you. Otherwise, shut up.'], { pastReplies: habit });
  assert.equal(reply, 'Sick of you.');
});

test('a reply that opens on a habit is tried again, not left as a stray tail', async () => {
  const { reply, calls } = await run(['Otherwise, shut up. Whatever you say.', 'Fine by me then.'], { pastReplies: habit });
  assert.equal(reply, 'Fine by me then.');
  assert.equal(calls.length, 2);
});

test('Captain right after she brought him up is cut', async () => {
  const { reply } = await run(["Watchin vids. Cap'n left his PC on."], { pastReplies: ["Cap'n ain't here."] });
  assert.equal(reply, 'Watchin vids.');
});

test('opening on Captain too soon is tried again', async () => {
  const { reply, calls } = await run(["Cap'n ain't playin'. Get lost.", 'Get lost then, ya creep.'], {
    pastReplies: ["Cap'n ain't here."],
  });
  assert.equal(reply, 'Get lost then, ya creep.');
  assert.equal(calls.length, 2);
});

test('Captain is fair game when they ask', async () => {
  const past = { pastReplies: ["Cap'n ain't here."] };
  assert.match((await run(["Watchin vids. Cap'n left his PC on."], past, [{ role: 'user', content: 'wheres captain' }])).reply, /Cap'n/);
  assert.equal((await run(["Cap'n does."], past, [{ role: 'user', content: 'who decides that' }])).reply, "Cap'n does.");
  assert.equal((await run(["He's boring."], past, [{ role: 'user', content: "what's he like" }])).reply, "He's boring.");
  assert.equal((await run(["Cap'n made me."], { ...past, scripted: true }, [{ role: 'user', content: 'lol who cares' }])).reply, "Cap'n made me.");
});

test('Captain is allowed again after a gap', async () => {
  const { reply } = await run(["Watchin vids. Cap'n left his PC on."], { pastReplies: ["Cap'n ain't here.", 'e', 'f', 'g', 'h'] });
  assert.match(reply, /Cap'n/);
});

test('calling them Captain gets cut, or tried again if that is how it opens', async () => {
  assert.equal((await run(["Sure thing. Whatever you say, Cap'n."])).reply, 'Sure thing.');
  const opening = await run(["Whatever, cap'n.", 'Whatever you say.']);
  assert.equal(opening.reply, 'Whatever you say.');
  assert.equal(opening.calls.length, 2);
});

test('a reply with no words is not a repeat', async () => {
  const { reply, calls } = await run(['7'], { pastReplies: ['5'] });
  assert.equal(reply, '7');
  assert.equal(calls.length, 1);
});

test('a fact answer keeps its first sentence', async () => {
  const { reply } = await run(['Noa leads it. Otherwise, shut up.'], {
    pastReplies: ['Ask someone else about it. Otherwise, shut up.'],
    factual: true,
  });
  assert.ok(reply.startsWith('Noa leads it.'));
});

test("someone grieving: her words are left alone", async () => {
  const { reply } = await run(['Sorry. Otherwise, shut up.'], { pastReplies: habit, gentle: true });
  assert.equal(reply, 'Sorry. Otherwise, shut up.');
});

const history = [
  { role: 'user', content: 'u1' }, { role: 'assistant', content: 'a1' },
  { role: 'user', content: 'u2' }, { role: 'assistant', content: 'a2' },
  { role: 'user', content: 'u3' }, { role: 'assistant', content: 'a3' },
  { role: 'user', content: 'u4' }, { role: 'assistant', content: 'a4' },
  { role: 'user', content: 'u5' },
];

test('she sees whole exchanges, her last 3 replies, never opening on one of hers', () => {
  assert.equal(history[recentStart(history)].content, 'u2');
  assert.equal(recentStart(history.slice(0, 5)), 0);
});

test('retries see less, and never quote the reply they rejected', async () => {
  const stale = "You ain't worth my time today.";
  const ollama = stubOllama([stale, stale, 'Different words here now.']);
  await chatFresh([{ role: 'system', content: 'prompt' }, ...history], { pastReplies: [stale] });
  const seen = (i) => ollama.calls[i].messages.map((m) => m.content).join();
  assert.equal(seen(1), 'prompt,u4,a4,u5');
  assert.equal(seen(2), 'prompt,u5');
  assert.ok(!JSON.stringify(ollama.calls.slice(1)).includes(stale));
});

test('retries for someone grieving keep the whole conversation', async () => {
  const stale = "You ain't worth my time today.";
  const ollama = stubOllama([stale, 'Different words here now.']);
  await chatFresh([{ role: 'system', content: 'grief' }, ...history], { pastReplies: [stale], gentle: true });
  assert.equal(ollama.calls[1].messages.length, history.length + 1);
});

test('every request asks Ollama to keep the model loaded', async () => {
  const ollama = stubOllama(['Yo.']);
  await chatFresh([{ role: 'system', content: 'prompt' }, { role: 'user', content: 'hi' }]);
  await warmUp();
  assert.ok(ollama.calls.every((call) => call.keep_alive === '1h'));
});

test('warming up only loads the model, at the same context size as a reply', async () => {
  const ollama = stubOllama(['Yo.']);
  await warmUp();
  await chatFresh([{ role: 'system', content: 'prompt' }, { role: 'user', content: 'hi' }]);
  const [load, reply] = ollama.calls;
  assert.deepEqual(load.messages, []);
  assert.equal(load.options.num_ctx, reply.options.num_ctx);
});
