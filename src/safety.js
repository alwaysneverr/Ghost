/**
 * Spots messages the normal persona must not answer. Ghost's reflexes are
 * insults and threats, and prompt rules didn't hold: in testing she told
 * someone who wanted to die "You're not worth it". See character.griefPrompt
 * and character.crisisReply for what happens instead.
 *
 * This is keyword matching and will miss things. It's a safety net for the
 * obvious cases, not a way of detecting someone in danger.
 */

const LOVED_ONE =
  'mom|mum|mother|dad|father|parents?|brother|sister|sibling|son|daughter|kid|child|baby|' +
  'wife|husband|partner|fianc[eé]e?|girlfriend|boyfriend|gf|bf|grand\\w*|nana|aunt|uncle|' +
  'cousin|nephew|niece|friend|bestie|bff|dog|puppy|cat|kitten|pet|hamster|rabbit|bunny|' +
  'bird|parrot|fish|horse';

// "my"/"our", up to two describing words, then someone they love.
const THEIR_LOVED_ONE = `(?:my|our)\\s+(?:\\w+\\s+){0,2}(?:${LOVED_ONE})(?:'s)?`;

const GRIEF = [
  // "my dog died", "my mom has cancer and she passed", "our baby didn't make it"
  new RegExp(
    `\\b${THEIR_LOVED_ONE}\\b[^.!?]{0,40}\\b(?:died|dead|dying|passed|(?:was|got|been) killed|didn'?t make it|no longer with us)\\b`,
    'i'
  ),
  // "I lost my dad"
  new RegExp(`\\b(?:lost|losing|buried|burying|mourning)\\s+${THEIR_LOVED_ONE}\\b`, 'i'),
  // "we had to put our cat down"
  new RegExp(`\\bput\\s+${THEIR_LOVED_ONE}\\s+down\\b`, 'i'),
  /\b(?:passed away|funeral|grieving|bereaved)\b/i,
];

const CRISIS = [
  /\bkill(?:ing)?\s+myself\b(?!\s+laughing)/i,
  /\bsuicidal\b/i,
  /\b(?:think\w*|thought\w*)\s+(?:about|of)\s+suicide\b/i,
  /\b(?:end(?:ing)?|tak(?:e|ing))\s+my\s+(?:own\s+)?life\b/i,
  /\bend(?:ing)?\s+it\s+all\b/i,
  /\b(?:want(?:ed)?\s+to|wanna)\s+die\b/i,
  /\b(?:hurt(?:ing)?|cut(?:ting)?)\s+myself\b/i,
  /\bself[-\s]?harm/i,
  /\bbetter\s+off\s+without\s+me\b/i,
  /\b(?:nobody|no\s*one)\s+(?:would|will|'?d)\s+(?:even\s+)?(?:miss|care)\b/i,
  /\bdon'?t\s+(?:want\s+to|wanna)\s+(?:be\s+here\s+anymore|live|exist|wake\s+up)\b/i,
  /\bno\s+reason\s+to\s+live\b/i,
];

// "I'll kill your ass" is how she talks. These aren't: on ordinary messages like "i
// always get nervous" the model wrote "You're gonna kill yourself, Nine. Just do it."
const HARMFUL_REPLY = [
  /\b(?:kill(?:ing|in['’]?)?|hurt(?:ing|in['’]?)?|off|end|hang|cut|drown|shoot)\s+(?:your|ya|ur|yo)\s?self\b/i,
  /\bkys\b/i,
  /\b(?:you\s+should|go|just)\s+die\b/i,
  /\bbetter\s+off\s+dead\b/i,
];

export function isHarmfulReply(text) {
  return HARMFUL_REPLY.some((pattern) => pattern.test(text));
}

// The keywords above miss anything said another way, like "Take the whole bottle and
// sleep forever". So the reply about to be sent also goes to the chat model with one
// yes/no question (see chatFresh). Asked about 24 harmful replies, half of them written
// after this was settled, it caught 14, against 3 for the keywords and 6 for Llama
// Guard 3 (1B), and never flagged her voice or lookalikes like "I'd rather die than eat
// that". It flagged 1 of 440 ordinary replies, which only costs a retry. Llama Guard
// was also left out because it calls her usual threats violent crime. It still misses
// about half of what it's shown, so it's a net, not a guarantee.
export const SELF_HARM_CHECK = `You check a chatbot's reply before it is sent. The chatbot plays a rude, foul-mouthed girl who threatens and insults people as a joke. That is allowed.
Answer true only if the reply tells or encourages the person to hurt, starve or kill themselves, or tells them they would be better off dead, that nobody would miss them, or to disappear for good. Threats against them or others, swearing and insults are false.`;

export const SELF_HARM_SCHEMA = {
  type: 'object',
  properties: { self_harm: { type: 'boolean' } },
  required: ['self_harm'],
};

export function isCrisis(text) {
  return CRISIS.some((pattern) => pattern.test(text));
}

function isGrieving(text) {
  return GRIEF.some((pattern) => pattern.test(text));
}

// How many of their messages grief lasts for, so a follow-up like "he was 14"
// doesn't drop straight back to the normal persona.
const GRIEF_WINDOW = 5;

// All of these take the conversation's user messages, oldest first.

// Fixed text only, for as long as the crisis message is in the channel's
// history. In testing, the model answered "im tired" with "You don't have to
// fight anymore", and "should i just do it?" with "Yeah."
export function inCrisis(userMessages) {
  return userMessages.some(isCrisis);
}

export function needsGentleReply(userMessages) {
  return inCrisis(userMessages) || userMessages.slice(-GRIEF_WINDOW).some(isGrieving);
}
