import { Events, ActivityType } from 'discord.js';
 
export default {
  name: Events.ClientReady,
  once: true,
 
  execute(client) {
    console.log(`\nAlright, I'm here. Oi, whaddaya mean who am I? It's ${client.user.username}! Quit joking around. Whaddaya need, Captain?`);
    console.log(`📡 Yeah, yeah, I'm serving only ${client.guilds.cache.size} person in this world. You, Nine.\n`);
    client.user.setActivity({
      name: 'sigh',
      type: ActivityType.Custom,
      state: 'Alright then, whaddaya want?',
      emoji: {
        id: '1528770862461747251',
        name: 'GhostWeary',
      }
    });
  },
};