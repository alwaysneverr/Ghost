import 'dotenv/config';
import { Client, GatewayIntentBits, Collection, Partials, Events } from 'discord.js';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessageReactions,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

client.commands = new Collection();

// ── Load Commands ──────────────────────────────────────────────────────────────
const commandsPath = join(__dirname, 'commands');
const commandFiles = readdirSync(commandsPath).filter((f) => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = (await import(pathToFileURL(join(commandsPath, file)).href)).default;
  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
    console.log(`✅ Loaded command: /${command.data.name}`);
  } else {
    console.warn(`⚠️  Skipping ${file} — missing "data" or "execute" export`);
  }
}

// ── Load Events ────────────────────────────────────────────────────────────────
const eventsPath = join(__dirname, 'events');
const eventFiles = readdirSync(eventsPath).filter((f) => f.endsWith('.js'));

for (const file of eventFiles) {
  const event = (await import(pathToFileURL(join(eventsPath, file)).href)).default;
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
  console.log(`✅ Loaded event: ${event.name}`);
}

// ── Staying up ─────────────────────────────────────────────────────────────────
// Node exits on a promise rejection nobody handled, and the client on an 'error' event
// nobody listens for. Either one is a bug to log and fix, not a reason to drop everyone
// mid-conversation. A thrown exception still exits; systemd brings her back.
process.on('unhandledRejection', (error) => console.error('❌ Unhandled rejection:', error));
client.on(Events.Error, (error) => console.error('❌ Discord client error:', error));

// systemctl stop/restart sends SIGTERM, Ctrl+C sends SIGINT. Logging out first takes her
// offline straight away, instead of looking online for a minute while nobody's home.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, async () => {
    console.log(`👋 ${signal}: logging out.`);
    try {
      await client.destroy();
    } finally {
      process.exit(0);
    }
  });
}

// ── Login ──────────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);
