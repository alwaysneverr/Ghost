import { Events } from 'discord.js';
import { isAwaitingText, logSent } from '../logger.js';

// A command she answered with deferReply gets its text here, in an edit to the
// "thinking…" placeholder. Every other edit is left alone.
export default {
  name: Events.MessageUpdate,
  once: false,

  async execute(_oldMessage, message) {
    if (!isAwaitingText(message.id)) return;
    try {
      if (message.partial) await message.fetch();
    } catch (_error) {
      // e.g. a DM between other people, which she can't read back
      return;
    }
    logSent(message);
  },
};
