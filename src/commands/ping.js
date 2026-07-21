import {
  SlashCommandBuilder,
  InteractionContextType,
  ApplicationIntegrationType,
} from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Replies with Pong! and shows the bot latency.')
    .setContexts([
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    ])
    .setIntegrationTypes([
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    ]),

  async execute(interaction) {
    await interaction.deferReply();

    const latency = Math.abs(Date.now() - interaction.createdTimestamp);
    const apiLatency = Math.round(interaction.client.ws.ping);

    await interaction.editReply(
      `OOOORAAAH!! *ping* ⚾\n> Round-trip: **${latency}ms** | API: **${apiLatency}ms**`
    );
  },
};
