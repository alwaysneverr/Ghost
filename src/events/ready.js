import { Events } from 'discord.js';
 
export default {
  name: Events.ClientReady,
  once: true,
 
  execute(client) {
    console.log(`\n🤖 Bot is online! Logged in as: ${client.user.tag}`);
    console.log(`📡 Serving ${client.guilds.cache.size} server(s)\n`);
    client.user.setActivity('with discord.js');
  },
};