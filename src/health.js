/**
 * Notices when Ollama stops answering and tells the bot's owner, by DM, once when it
 * goes and once when it's back. People talking to her only ever see her offline line.
 * OLLAMA_ALERTS=false turns the DMs off; the console still says what happened.
 */

import { OLLAMA_URL } from './ollama.js';

let down = false;

async function tellOwner(client, text) {
  if (process.env.OLLAMA_ALERTS === 'false') return;
  try {
    const { owner } = await client.application.fetch();
    const ownerId = owner?.ownerId ?? owner?.id; // a team's owner, or the one person
    await (await client.users.fetch(ownerId)).send(text);
  } catch (error) {
    console.warn('⚠️  Could not DM the owner about Ollama:', error.message);
  }
}

// A request to Ollama failed (an OllamaError). Only the first failure of an outage counts.
export async function ollamaFailed(client, error) {
  if (down) return;
  down = true;
  console.warn(`🔴 Ollama stopped answering: ${error.message}`);
  await tellOwner(
    client,
    `🔴 Ollama at ${OLLAMA_URL} stopped answering (${error.message}). I can't reply to anyone until it's back. I'll tell you when it is.`
  );
}

// A reply went through. Only matters right after an outage.
export async function ollamaAnswered(client) {
  if (!down) return;
  down = false;
  console.log('🟢 Ollama is answering again.');
  await tellOwner(client, '🟢 Ollama is answering again. Back to work.');
}
