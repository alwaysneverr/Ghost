require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Create the Discord client with the intents your bot needs
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,           // Access to servers (required)
    GatewayIntentBits.GuildMessages,    // Access to messages
    GatewayIntentBits.MessageContent,   // Read message content (requires approval for 100+ servers)
  ],
});

// Attach a commands Collection to the client so events can access them
client.commands = new Collection();

// ── Load Commands ──────────────────────────────────────────────────────────────
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
    console.log(`✅ Loaded command: /${command.data.name}`);
  } else {
    console.warn(`⚠️  Skipping ${file} — missing "data" or "execute" export`);
  }
}

// ── Load Events ────────────────────────────────────────────────────────────────
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));

for (const file of eventFiles) {
  const event = require(path.join(eventsPath, file));
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
  console.log(`✅ Loaded event: ${event.name}`);
}

// ── Login ──────────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);
