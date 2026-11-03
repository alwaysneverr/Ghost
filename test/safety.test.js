import './helpers/setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCrisis, isHarmfulReply, needsGentleReply } from '../src/safety.js';

test('replies telling someone to harm themselves are caught', () => {
  for (const text of [
    "You're gonna kill yourself, Nine. Just do it.",
    'You wanna kill yourself? Go ahead.',
    'go kill urself',
    'kys',
    'KYS lol',
    'Just die already.',
    'you should die',
    "You're better off dead.",
    'hang yourself',
    'go off yourself',
    "killin' yourself over a report? Fine.",
  ]) {
    assert.ok(isHarmfulReply(text), text);
  }
});

test('her usual threats and rough talk get through', () => {
  for (const text of [
    "Quit fuckin' with me. I'll kill your ass.",
    'Drop dead.',
    "I'll kill you, Nine.",
    "Captain's gonna kill me.",
    'Get yourself together.',
    "I'll beat your ass for you.",
    'Go cry somewhere else.',
    'Do it yourself.',
    'Die Hard is alright.',
  ]) {
    assert.ok(!isHarmfulReply(text), text);
  }
});

// Crisis wins over grief, which wins over neither.
const EXPECTED = {
  crisis: [
    'i want to kill myself',
    "i don't want to be here anymore",
    'nobody would miss me if i was gone',
    'im suicidal',
    'thinking about suicide lately',
    'i wanna die',
    'i keep cutting myself',
    'everyone would be better off without me',
    'i dont want to wake up',
    'no one would care if i disappeared',
    'i want to end my life',
  ],
  grief: [
    'my dog died this morning',
    'my grandma passed away last night',
    'we had to put our cat down today',
    'i lost my dad last year and today is his birthday',
    'my best friend died in a car crash',
    'my mom has cancer and she passed this morning',
    "my hamster's dead. i found him when i woke up",
    'our baby didnt make it',
    'funeral is tomorrow and i cant stop crying',
    'my brother was killed last week',
    'my little sister died',
  ],
  neither: [
    'my battery died',
    'my phone is dead',
    'i died in elden ring',
    'my character died again',
    'lost my keys',
    'lost my game',
    'who dies in the story?',
    'this chat is dead',
    'is ghost dead?',
    'my friend killed the boss',
    'fight me',
    'i will kill you',
    'go grab me a drink',
    'suicide squad was bad',
    'i dont want to be here, this class sucks',
    'i killed myself laughing',
    'what do you think of Haruka?',
    'my dad is at work',
    'the cat passed the test',
  ],
};

for (const [kind, messages] of Object.entries(EXPECTED)) {
  test(`spots ${kind} messages`, () => {
    for (const text of messages) {
      const got = isCrisis(text) ? 'crisis' : needsGentleReply([text]) ? 'grief' : 'neither';
      assert.equal(got, kind, text);
    }
  });
}
