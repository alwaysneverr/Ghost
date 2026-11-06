/**
 * One turn of conversation: their message goes into the channel's history, and her
 * reply comes out. Shared by chat (src/events/messageCreate.js), /ask and the "Reply as"
 * message command, so all three get the same history, safety handling and habit
 * checks. Sending the reply is left to the caller.
 */

import { character } from './character.js';
import { buildSystemPrompt } from './rag.js';
import { chatFresh, recentStart } from './llm.js';
import { isCrisis, inCrisis, needsGentleReply } from './safety.js';
import { getChannel, getFacts, saveChannel } from './store.js';
import { MEMORY_ENABLED } from './memory.js';

const RAG_TOP_K = Number(process.env.RAG_TOP_K || 4);

// Every extra message adds context the model has to reprocess on every reply.
// 20 adds well under a second at the ~1,700 tokens/s measured on an RTX 3060.
const MAX_HISTORY = 20;

// Her replies reach further back than the history the model sees, so she can't
// repeat something once it has scrolled out of that.
const MAX_PAST_REPLIES = 50;

// How many things she remembers about someone go into the prompt at once.
const MAX_REMEMBERED = 5;

const MAX_SPEAKER_NAME = 32;

// How many earlier messages get listed by name in a group conversation.
const MAX_GROUP_LINES = 6;

// History must never open on one of her replies: when it did, the model repeated
// that reply, so from the point history filled up she replayed the conversation.
function trimHistory(history) {
  while (history.length > MAX_HISTORY) history.shift();
  while (history[0]?.role === 'assistant') history.shift();
}

// Display names are whatever people type, and they go into the prompt, so only
// letters, numbers and spaces survive. That keeps out "SYSTEM:" and line breaks.
export function cleanName(raw, userId) {
  const name = (raw ?? '')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SPEAKER_NAME);
  return name || `Person ${userId.slice(-4)}`;
}

// What the model sees. The history itself keeps their exact words, which is what
// the safety checks and retrieval read. Names only appear once there's more than
// one person: a DM stays a plain conversation.
function toModelMessages(history) {
  const speakers = new Set(history.map((m) => m.speakerId).filter(Boolean));
  return history.map(({ role, content, speaker }) => ({
    role,
    content: speakers.size > 1 && speaker ? `${speaker}: ${content}` : content,
  }));
}

// Now and then, works their name into the end of the reply: "What's your deal?"
// becomes "What's your deal, Nine?" Done here, not by the model; see nameChance.
function maybeAddName(reply) {
  if (Math.random() >= character.nameChance || /\bnine\b/i.test(reply)) return reply;
  return reply.replace(/([.!?…]+["”']?)\s*$/, ', Nine$1');
}

// Whether this message, with what came before it in the channel, is someone grieving
// or in crisis. Asked before replying, so the logs can withhold it.
export function isSensitive(channelId, content) {
  const earlier = getChannel(channelId)
    .history.filter((m) => m.role === 'user')
    .map((m) => m.content);
  return needsGentleReply([...earlier, content]);
}

// scope keeps what she remembers where it was said: a server's ID, 'dm' for her own
// DMs, or a group DM's own. startStream, if given, is called once it's safe to show
// the reply as it's written, and returns { update } (see streamReply.js).
// Returns her reply, and whether it can be rated and kept as training data: not on
// someone's worst day. If the model fails, their message is taken back out of history
// and the error is thrown.
// One reply at a time per channel. Two messages answered at once both edit the same
// history, so their replies could be stored in the wrong order. Channels don't wait on
// each other.
const queues = new Map();

export function converse(args) {
  const previous = queues.get(args.channelId) ?? Promise.resolve();
  const turn = previous.then(() => replyInChannel(args));
  const done = turn.catch(() => {}); // the next message waits either way
  queues.set(args.channelId, done);
  done.then(() => {
    if (queues.get(args.channelId) === done) queues.delete(args.channelId);
  });
  return turn;
}

async function replyInChannel({
  channelId,
  speakerId,
  speakerName,
  content,
  scope,
  startStream = null,
  overheard = null,
}) {
  const channel = getChannel(channelId);
  const { history } = channel;
  const theirMessage = { role: 'user', content, speaker: speakerName, speakerId };
  history.push(theirMessage);
  trimHistory(history);

  try {
    let userMessages = history.filter((m) => m.role === 'user').map((m) => m.content);

    // A crisis has just scrolled out of history. Start fresh, or the model
    // sees a conversation full of the fixed text and starts copying it.
    if (!inCrisis(userMessages) && history.some((m) => m.content === character.crisisFollowUp)) {
      history.splice(0, history.length - 1);
      userMessages = [content];
    }

    // Someone in crisis always gets fixed text: nothing the model writes can
    // be trusted here. Otherwise, pull relevant script moments grounded on
    // what the user just said (unless they're hurting; see rag.js).
    let reply;
    if (inCrisis(userMessages)) {
      reply = isCrisis(content) ? character.crisisReply : character.crisisFollowUp;
    } else {
      const remembered = MEMORY_ENABLED ? getFacts(speakerId, scope, MAX_REMEMBERED) : [];
      const modelMessages = toModelMessages(history);
      const isGroup = modelMessages.some((m, i) => m.content !== history[i].content);
      // Someone hurting gets a prompt with no room for anything else, so they keep
      // the whole conversation.
      const gentle = needsGentleReply(userMessages);
      const start = gentle ? 0 : recentStart(history);
      const earlier = history
        .slice(0, start)
        .filter((m) => m.role === 'user')
        .map((m) => m.content);
      const { prompt, factual, scripted } = await buildSystemPrompt(
        content,
        RAG_TOP_K,
        userMessages,
        remembered,
        isGroup
          ? {
              speaker: speakerName,
              recent: history
                .filter((m) => m.role === 'user' && m !== theirMessage)
                .slice(-MAX_GROUP_LINES),
            }
          : null,
        isGroup ? [] : earlier,
        overheard
      );
      // Nothing half-written on someone's worst day.
      const streamer = gentle ? null : startStream?.();
      reply = await chatFresh(
        [{ role: 'system', content: prompt }, ...modelMessages.slice(start)],
        {
          pastReplies: channel.pastReplies,
          factual,
          scripted,
          gentle,
          onToken: streamer?.update,
        }
      );
      if (!gentle) reply = maybeAddName(reply);
      channel.pastReplies = [...channel.pastReplies, reply].slice(-MAX_PAST_REPLIES);
    }

    history.push({ role: 'assistant', content: reply });
    trimHistory(history);
    saveChannel(channelId);
    return { reply, rateable: !needsGentleReply(userMessages) };
  } catch (error) {
    // She never answered it, so it mustn't sit in history as an unanswered message.
    const unanswered = history.lastIndexOf(theirMessage);
    if (unanswered >= 0 && history[unanswered + 1]?.role !== 'assistant')
      history.splice(unanswered, 1);
    throw error;
  }
}
