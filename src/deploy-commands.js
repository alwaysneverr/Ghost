/**
 * deploy-commands.js
 *
 * Run this script once whenever you ADD or CHANGE slash commands.
 * It registers them with Discord's API so they appear in the client.
 *
 * Usage:
 *   node src/deploy-commands.js           → global (takes ~1 hour to propagate)
 *   GUILD_ID=xxx node src/deploy-commands.js  → guild-only (instant, great for dev)
 */

require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('❌ Missing DISCORD_TOKEN or CLIENT_ID in your .env file');
  process.exit(1);
}

// Collect all command definitions
const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if ('data' in command) {
    commands.push(command.data.toJSON());
    console.log(`📝 Queued: /${command.data.name}`);
  }
}

const rest = new REST().setToken(DISCORD_TOKEN);

(async () => {
  try {
    console.log(`\n🚀 Registering ${commands.length} slash command(s)...`);

    let data;
    if (GUILD_ID) {
      // Guild commands are instant — perfect for development
      data = await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands }
      );
      console.log(`✅ Registered ${data.length} command(s) to guild ${GUILD_ID} (instant)`);
    } else {
      // Global commands take ~1 hour to roll out across all servers
      data = await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commands }
      );
      console.log(`✅ Registered ${data.length} global command(s) (~1 hour to propagate)`);
    }
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
  }
})();
