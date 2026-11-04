import {
  SlashCommandBuilder,
  InteractionContextType,
  ApplicationIntegrationType,
  MessageFlags,
} from 'discord.js';
import { isBotAdmin } from '../access.js';
import { warmUp } from '../llm.js';
import { warmUpRetrieval } from '../rag.js';
import { gatherStatus } from '../status.js';

const size = (bytes) =>
  bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(1)} GB`
    : bytes >= 1e6
      ? `${(bytes / 1e6).toFixed(1)} MB`
      : `${(bytes / 1e3).toFixed(1)} KB`;

function duration(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function modelLine(model, now) {
  if (!model.installed)
    return `🔴 ${model.name} isn't installed. Run \`ollama pull ${model.name}\`.`;
  if (!model.loaded)
    return `⚪ ${model.name} isn't loaded, so the next reply waits for it (about 7 seconds).`;
  const context = model.context ? `, ${model.context} context` : '';
  const unloads = model.unloadsAt ? `, unloads in ${duration(model.unloadsAt - now)}` : '';
  return `🟢 ${model.name} loaded (${size(model.gpuBytes)} on the GPU${context}${unloads})`;
}

// Plain text, so it reads the same on a phone.
export function formatStatus(status, now = Date.now()) {
  const { ollama, discord, scenes, stored, logs, process } = status;
  const lines = [];
  if (ollama.reachable) {
    lines.push(`🟢 Ollama ${ollama.version} at ${status.url}`);
    for (const model of ollama.models) lines.push(`   ${modelLine(model, now)}`);
  } else {
    lines.push(
      `🔴 Can't reach Ollama at ${status.url} (${ollama.error}). She can't reply until it's running.`
    );
  }
  lines.push(
    `🟢 Discord: ${discord.servers} server(s), ${discord.pingMs} ms ping, up ${duration(discord.uptimeMs ?? 0)}`
  );
  lines.push(
    scenes.error
      ? `🔴 Scenes: ${scenes.error}`
      : scenes.total === 0
        ? '⚪ Scenes: none, so she replies without the script. Run `npm run index`.'
        : `📚 Scenes: ${scenes.usable} of ${scenes.total} searchable (the rest give away late reveals)`
  );
  lines.push(
    stored.error
      ? `🔴 ghost.db: ${stored.error}`
      : `💾 ghost.db: ${stored.conversations} conversation(s), ${stored.facts} remembered fact(s), ${stored.reminders} reminder(s) waiting`
  );
  lines.push(
    status.replyCheck
      ? '🛡️ Replies are checked for self-harm by keywords and by the chat model'
      : '⚠️ Replies are checked for self-harm by keywords only (REPLY_CHECK=false)'
  );
  const kept = status.messageLogDays
    ? `kept for ${status.messageLogDays} day(s)`
    : 'kept until you delete it';
  lines.push(
    `📝 Logs: ${logs.map((log) => `${log.name} ${size(log.bytes)}`).join(', ')}. The message log is ${kept}.`
  );
  lines.push(
    `⚙️ Ghost ${process.version}, Node ${process.node}, ${size(process.memoryBytes)} in use, models kept loaded for ${status.keepAlive}`
  );
  return lines.join('\n');
}

export default {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check that she and Ollama are working. Owner and team admins only.')
    // Hides it from non-admins in servers. Discord ignores this in DMs and for user
    // installs, so the check in execute() is what actually enforces it.
    .setDefaultMemberPermissions(0)
    .setContexts([
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    ])
    .setIntegrationTypes([
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    ])
    .addBooleanOption((option) =>
      option
        .setName('load_models')
        .setDescription('Load the models now, so nobody waits for them')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { client, user } = interaction;
    if (!(await isBotAdmin(client, user.id))) {
      console.warn(`🚫 ${user.username} (${user.id}) tried to use /status.`);
      await interaction.editReply(`Nice try, Nine. That one's not for you.`);
      return;
    }

    let loading = '';
    if (interaction.options.getBoolean('load_models')) {
      const started = Date.now();
      try {
        await Promise.all([warmUp(), warmUpRetrieval()]);
        loading = `Loaded the models in ${((Date.now() - started) / 1000).toFixed(1)}s.\n`;
      } catch (error) {
        loading = `Couldn't load the models: ${error.message}\n`;
      }
    }
    await interaction.editReply(`${loading}${formatStatus(await gatherStatus(client))}`);
  },
};
