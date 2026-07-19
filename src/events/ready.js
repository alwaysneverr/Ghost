const { Events } = require('discord.js');

module.exports = {
  name: Events.ClientReady,
  once: true, // This event fires only once when the bot starts

  execute(client) {
    console.log(`\n🤖 Bot is online! Logged in as: ${client.user.tag}`);
    console.log(`📡 Serving ${client.guilds.cache.size} server(s)\n`);

    // Set the bot's "Playing ..." status
    client.user.setActivity('with discord.js');
  },
};
