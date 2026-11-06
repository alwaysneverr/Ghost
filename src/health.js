/**
 * Notices when Ollama stops answering and tells the people who run her (the owner and,
 * for a team, its accepted admins: the same people /status lets in), by DM, once when it
 * goes and once when it's back. People talking to her only ever see her offline line.
 * OLLAMA_ALERTS=false turns the DMs off; the console still says what happened.
 */

import { botAdminIds } from './access.js';
import { OLLAMA_URL } from './ollama.js';

let down = false;

async function tellAdmins(client, text) {
  if (process.env.OLLAMA_ALERTS === 'false') return;
  let ids;
  try {
    ids = await botAdminIds(client);
  } catch (error) {
    console.warn('⚠️  Could not look up who to tell about Ollama:', error.message);
    return;
  }
  // One person's closed DMs mustn't stop the others hearing about it.
  await Promise.all(
    ids.map(async (id) => {
      try {
        await (await client.users.fetch(id)).send(text);
      } catch (error) {
        console.warn(`⚠️  Could not DM ${id} about Ollama:`, error.message);
      }
    })
  );
}

// A request to Ollama failed (an OllamaError). Only the first failure of an outage counts.
export async function ollamaFailed(client, error) {
  if (down) return;
  down = true;
  console.warn(`🔴 Ollama stopped answering: ${error.message}`);
  await tellAdmins(
    client,
    `🔴 Ollama at ${OLLAMA_URL} stopped answering (${error.message}). I can't reply to anyone until it's back. I'll tell you when it is.`
  );
}

// A reply went through. Only matters right after an outage.
export async function ollamaAnswered(client) {
  if (!down) return;
  down = false;
  console.log('🟢 Ollama is answering again.');
  await tellAdmins(client, '🟢 Ollama is answering again. Back to work.');
}
