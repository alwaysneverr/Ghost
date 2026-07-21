import { Events } from 'discord.js';

export default {
  name: Events.MessageCreate,
  once: false,
  async execute(message) {
    const client = message.client;

    if (message.author.bot || message.webhookId || message.author.id === client.user.id) return;

    if (message.mentions.has(client.user) && !message.mentions.everyone) {
      const pingRants = [
        `Unless the server is literally on fire, don't you dare ping me, ${message.author}.`,
        `Tch, another ghost ping? You guys really love testing my patience. What do you want, Captain?`,
        `Stop pinging me. Go ask Sophitia or someone else. I'm off duty.`,
        `Do I look like a customer service bot to you, ${message.author}? Use a slash command if you want something.`,
      ];

      const chosenRant = pingRants[Math.floor(Math.random() * pingRants.length)];

      try {
        await message.reply(chosenRant);
      } catch (_error) {
        // If the reply fails (e.g., the channel is deleted), ignore it to prevent the bot from crashing
      }
    }
  },
};
