import { Events, ActivityType } from 'discord.js';
import { restoreReminders } from '../reminders.js';
import { startLogPruning } from '../logger.js';
import { warmUp } from '../llm.js';
import { warmUpRetrieval } from '../rag.js';

// Loads the models while nobody's waiting. Also the first sign that Ollama isn't
// running, before anyone finds out by messaging her.
async function loadModels() {
  const started = Date.now();
  try {
    await Promise.all([warmUp(), warmUpRetrieval()]);
    console.log(`🔥 Models loaded in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
  } catch (error) {
    console.warn(
      `⚠️  Couldn't load the models (${error.message}). Is Ollama running? She'll try again on the first message.`
    );
  }
}

export default {
  name: Events.ClientReady,
  once: true,

  execute(client) {
    console.log(
      `\nAlright, I'm here. Oi, whaddaya mean who am I? It's ${client.user.username}! Quit joking around. Whaddaya need, Nine?`
    );
    console.log(
      `📡 Yeah, yeah, I'm serving only ${client.guilds.cache.size} person in this world. You, Nine.\n`
    );
    client.user.setActivity({
      name: 'sigh',
      type: ActivityType.Custom,
      state: 'Alright then, whaddaya want?',
      emoji: {
        id: '1528770862461747251',
        name: 'GhostWeary',
      },
    });
    restoreReminders(client);
    startLogPruning();
    loadModels();
  },
};
