import { Events } from 'discord.js';
import { logRating } from '../logger.js';

export default {
  name: Events.MessageReactionAdd,

  async execute(reaction, user) {
    if (user.bot) return;
    if (!['👍', '👎'].includes(reaction.emoji.name)) return;

    // Reactions on messages the bot hasn't cached arrive partial — fetch first
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch {
        return;
      }
    }
    if (reaction.message.partial) {
      try {
        await reaction.message.fetch();
      } catch {
        return;
      }
    }

    // Only count ratings left on the bot's own messages
    if (reaction.message.author?.id !== reaction.client.user.id) return;

    logRating({
      messageId: reaction.message.id,
      rating: reaction.emoji.name === '👍' ? 'up' : 'down',
      raterId: user.id,
    });
  },
};