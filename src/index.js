import 'dotenv/config';
import { Client, GatewayIntentBits, Collection } from 'discord.js';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
 
const __dirname = dirname(fileURLToPath(import.meta.url));
 
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});
 
client.commands = new Collection();
 
// ── Load Commands ──────────────────────────────────────────────────────────────
const commandsPath = join(__dirname, 'commands');
const commandFiles = readdirSync(commandsPath).filter(f => f.endsWith('.js'));
 
for (const file of commandFiles) {
  const command = await import(join(commandsPath, file));
  if ('data' in command.default && 'execute' in command.default) {
    client.commands.set(command.default.data.name, command.default);
    console.log(`✅ Loaded command: /${command.default.data.name}`);
  } else {
    console.warn(`⚠️  Skipping ${file} — missing "data" or "execute" export`);
  }
}
 
// ── Load Events ────────────────────────────────────────────────────────────────
const eventsPath = join(__dirname, 'events');
const eventFiles = readdirSync(eventsPath).filter(f => f.endsWith('.js'));
 
for (const file of eventFiles) {
  const event = (await import(join(eventsPath, file))).default;
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
  console.log(`✅ Loaded event: ${event.name}`);
}
 
// ── Login ──────────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);